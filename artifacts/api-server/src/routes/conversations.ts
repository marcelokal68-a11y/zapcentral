/**
 * Conversation management routes.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  conversationsTable,
  contactsTable,
  departmentsTable,
  tenantUsersTable,
  agentStatusesTable,
  channelSettingsTable,
  whatsappInstancesTable,
  messagesTable,
  departmentAgentsTable,
} from "@workspace/db";
import { eq, and, desc, sql, isNull, or, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";
import { sendTenantMessage, tryAutoAssign } from "../services/ivr";
import { emitToTenant, emitToAgent } from "../services/socket";

const router = Router();

const transferSchema = z.object({
  toDepartmentId: z.number().int().optional(),
  toAgentId: z.string().optional(),
  note: z.string().max(500).optional(),
});

const closeSchema = z.object({
  note: z.string().max(500).optional(),
});

const assignSchema = z.object({
  agentId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// List conversations
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/conversations",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const { userId } = getAuth(req);
    const uid = userId!;
    const status = String(req.query["status"] ?? "");
    const departmentId = req.query["departmentId"]
      ? Number(req.query["departmentId"])
      : undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Number(req.query["offset"] ?? 0);

    // Check if caller is supervisor or admin (can see all)
    const [membership] = await db
      .select({ role: tenantUsersTable.role })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, uid),
        ),
      )
      .limit(1);

    const isAdminOrSupervisor = ["admin", "supervisor"].includes(
      membership?.role ?? "",
    );

    const conditions = [eq(conversationsTable.tenantId, tenantId)];

    if (status && status !== "all") {
      conditions.push(
        eq(conversationsTable.status, status as "new" | "ivr" | "waiting" | "active" | "closed"),
      );
    }
    if (departmentId) {
      conditions.push(eq(conversationsTable.departmentId, departmentId));
    }

    // Access control for non-admin/supervisor agents:
    //   - Unassigned (waiting/new/ivr) conversations are scoped to departments the agent belongs to.
    //   - Agents always see their own assigned conversations regardless of department.
    if (!isAdminOrSupervisor) {
      // Fetch agent's department memberships for queue visibility scoping
      const agentDepts = await db
        .select({ departmentId: departmentAgentsTable.departmentId })
        .from(departmentAgentsTable)
        .where(eq(departmentAgentsTable.clerkUserId, uid));

      const deptIds = agentDepts.map((d) => d.departmentId);

      // An unassigned conversation is visible if it has no department OR is in one the agent belongs to
      const deptAccessFilter =
        deptIds.length > 0
          ? or(
              isNull(conversationsTable.departmentId),
              inArray(conversationsTable.departmentId, deptIds),
            )!
          : isNull(conversationsTable.departmentId);

      // If caller requests a specific department they don't belong to, return empty
      if (
        departmentId &&
        deptIds.length > 0 &&
        !deptIds.includes(departmentId)
      ) {
        res.json({ conversations: [], total: 0, limit, offset });
        return;
      }

      const isExplicitlyWaiting = status === "waiting";
      if (isExplicitlyWaiting) {
        // Queue tab: only waiting conversations from agent's departments (or unrouted)
        conditions.push(deptAccessFilter);
      } else if (!status || status === "all") {
        // Default/all tab: own conversations + unassigned queue scoped to agent's departments
        conditions.push(
          or(
            eq(conversationsTable.assignedTo, uid),
            and(
              or(
                eq(conversationsTable.status, "waiting"),
                eq(conversationsTable.status, "new"),
                eq(conversationsTable.status, "ivr"),
              )!,
              deptAccessFilter,
            )!,
          )!,
        );
      } else {
        // Specific active/closed tab: only agent's own
        conditions.push(eq(conversationsTable.assignedTo, uid));
      }
    }

    const [conversations, totalResult] = await Promise.all([
      db
        .select({
          conversation: conversationsTable,
          contact: {
            id: contactsTable.id,
            phone: contactsTable.phone,
            name: contactsTable.name,
            cpf: contactsTable.cpf,
            avatarUrl: contactsTable.avatarUrl,
          },
          departmentName: departmentsTable.name,
          departmentColor: departmentsTable.color,
        })
        .from(conversationsTable)
        .innerJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
        .leftJoin(departmentsTable, eq(conversationsTable.departmentId, departmentsTable.id))
        .where(and(...conditions))
        .orderBy(desc(conversationsTable.lastMessageAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversationsTable)
        .where(and(...conditions)),
    ]);

    res.json({
      conversations: conversations.map((r) => ({
        ...r.conversation,
        contact: r.contact,
        departmentName: r.departmentName,
        departmentColor: r.departmentColor,
      })),
      total: totalResult[0]?.count ?? 0,
      limit,
      offset,
    });
  },
);

// ---------------------------------------------------------------------------
// Get single conversation
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/conversations/:conversationId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    const [result] = await db
      .select({
        conversation: conversationsTable,
        contact: contactsTable,
        departmentName: departmentsTable.name,
        departmentColor: departmentsTable.color,
      })
      .from(conversationsTable)
      .innerJoin(contactsTable, eq(conversationsTable.contactId, contactsTable.id))
      .leftJoin(departmentsTable, eq(conversationsTable.departmentId, departmentsTable.id))
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.tenantId, tenantId),
        ),
      );

    if (!result) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Agents can only view their own assigned conversations
    const [membership] = await db
      .select({ role: tenantUsersTable.role })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, uid),
        ),
      )
      .limit(1);

    const isAdminOrSupervisor = ["admin", "supervisor"].includes(
      membership?.role ?? "",
    );

    if (
      !isAdminOrSupervisor &&
      result.conversation.assignedTo !== uid
    ) {
      res.status(403).json({ error: "Forbidden: not your conversation" });
      return;
    }

    res.json({
      ...result.conversation,
      contact: result.contact,
      departmentName: result.departmentName,
      departmentColor: result.departmentColor,
    });
  },
);

// ---------------------------------------------------------------------------
// Pick conversation from queue (agent self-assigns) — atomic operation
// ---------------------------------------------------------------------------
router.post(
  "/tenants/:tenantId/conversations/:conversationId/pick",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    // Load conversation + membership in parallel (no agent status pre-flight — done atomically inside tx)
    const [[conv], [membership]] = await Promise.all([
      db
        .select({
          id: conversationsTable.id,
          status: conversationsTable.status,
          assignedTo: conversationsTable.assignedTo,
          departmentId: conversationsTable.departmentId,
        })
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.id, conversationId),
            eq(conversationsTable.tenantId, tenantId),
          ),
        )
        .limit(1),
      db
        .select({ role: tenantUsersTable.role, isSuperAdmin: tenantUsersTable.isSuperAdmin })
        .from(tenantUsersTable)
        .where(
          and(
            eq(tenantUsersTable.tenantId, tenantId),
            eq(tenantUsersTable.clerkUserId, uid),
          ),
        )
        .limit(1),
    ]);

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    if (conv.status !== "waiting") {
      res.status(400).json({ error: "Conversation is not in the queue" });
      return;
    }

    // Enforce department membership (admins and supervisors bypass)
    const isPrivileged =
      membership?.isSuperAdmin === true ||
      ["admin", "supervisor"].includes(membership?.role ?? "");

    if (!isPrivileged && conv.departmentId) {
      const [deptMember] = await db
        .select({ clerkUserId: departmentAgentsTable.clerkUserId })
        .from(departmentAgentsTable)
        .where(
          and(
            eq(departmentAgentsTable.clerkUserId, uid),
            eq(departmentAgentsTable.departmentId, conv.departmentId),
          ),
        )
        .limit(1);

      if (!deptMember) {
        res.status(403).json({
          error: "You are not a member of this conversation's department",
        });
        return;
      }
    }

    // Fully atomic pick: capacity check, conversation claim, and counter increment happen
    // in a single transaction. The capacity increment uses a conditional UPDATE so two
    // concurrent picks by the same agent cannot both exceed maxConversations.
    // If the conversation was claimed by another agent first, the transaction rolls back
    // the capacity increment automatically (no partial state).
    let updated: typeof conversationsTable.$inferSelect | undefined;
    try {
      updated = await db.transaction(async (tx) => {
        // 1. Atomically increment capacity — only succeeds when agent is not offline and under limit
        const [capacityOk] = await tx
          .update(agentStatusesTable)
          .set({
            activeConversations: sql`${agentStatusesTable.activeConversations} + 1`,
            status: "busy",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentStatusesTable.clerkUserId, uid),
              eq(agentStatusesTable.tenantId, tenantId),
              sql`${agentStatusesTable.status} != 'offline'`,
              sql`${agentStatusesTable.activeConversations} < ${agentStatusesTable.maxConversations}`,
            ),
          )
          .returning({ uid: agentStatusesTable.clerkUserId });

        if (!capacityOk) {
          // Diagnose why the conditional update found nothing
          const [agentRow] = await tx
            .select({
              status: agentStatusesTable.status,
              activeConversations: agentStatusesTable.activeConversations,
              maxConversations: agentStatusesTable.maxConversations,
            })
            .from(agentStatusesTable)
            .where(
              and(
                eq(agentStatusesTable.clerkUserId, uid),
                eq(agentStatusesTable.tenantId, tenantId),
              ),
            )
            .limit(1);

          if (!agentRow) {
            throw Object.assign(new Error("NO_STATUS"), { statusCode: 400 });
          } else if (agentRow.status === "offline") {
            throw Object.assign(new Error("AGENT_OFFLINE"), { statusCode: 400 });
          } else {
            throw Object.assign(new Error("AGENT_AT_CAPACITY"), { statusCode: 400 });
          }
        }

        // 2. Claim the conversation — only succeeds if still waiting + unassigned
        const [claimed] = await tx
          .update(conversationsTable)
          .set({ assignedTo: uid, status: "active", updatedAt: new Date() })
          .where(
            and(
              eq(conversationsTable.id, conversationId),
              eq(conversationsTable.tenantId, tenantId),
              eq(conversationsTable.status, "waiting"),
              isNull(conversationsTable.assignedTo),
            ),
          )
          .returning();

        if (!claimed) {
          // Throws → entire transaction rolls back (capacity increment undone automatically)
          throw Object.assign(new Error("ALREADY_CLAIMED"), { statusCode: 409 });
        }

        return claimed;
      });
    } catch (err: unknown) {
      const e = err as { message?: string; statusCode?: number };
      if (e.message === "NO_STATUS") {
        res.status(400).json({ error: "Set your status to available before picking a conversation" });
        return;
      }
      if (e.message === "AGENT_OFFLINE") {
        res.status(400).json({ error: "You must be available (not offline) to pick a conversation" });
        return;
      }
      if (e.message === "AGENT_AT_CAPACITY") {
        res.status(400).json({ error: "You are at maximum conversation capacity" });
        return;
      }
      if (e.message === "ALREADY_CLAIMED") {
        res.status(409).json({ error: "Conversation was already claimed by another agent" });
        return;
      }
      throw err;
    }

    emitToTenant(tenantId, "conversation_updated", { conversation: updated });

    res.json(updated);
  },
);

// ---------------------------------------------------------------------------
// Assign conversation to a specific agent (supervisor/admin)
// ---------------------------------------------------------------------------
router.post(
  "/tenants/:tenantId/conversations/:conversationId/assign",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);

    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const { agentId } = parsed.data;

    // Verify the agent is a member of this tenant
    const [agent] = await db
      .select()
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, agentId),
          eq(tenantUsersTable.status, "active"),
        ),
      )
      .limit(1);

    if (!agent) {
      res.status(400).json({ error: "Agent is not an active member of this tenant" });
      return;
    }

    // All state reads and mutations happen inside a single serializable transaction.
    // SELECT FOR UPDATE locks the conversation row so two concurrent supervisors
    // cannot both read the same stale previousAgent and double-decrement / over-increment.
    let updated: typeof conversationsTable.$inferSelect | undefined;
    let notFound = false;
    await db.transaction(async (tx) => {
      // Lock the row so concurrent assignments serialize here
      const [lockedConv] = await tx
        .select({ id: conversationsTable.id, assignedTo: conversationsTable.assignedTo })
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.id, conversationId),
            eq(conversationsTable.tenantId, tenantId),
          ),
        )
        .for("update")
        .limit(1);

      if (!lockedConv) { notFound = true; return; }

      const actualPreviousAgent = lockedConv.assignedTo;
      const isSameAgent = actualPreviousAgent === agentId;

      // Update the conversation
      const [updatedRow] = await tx
        .update(conversationsTable)
        .set({ assignedTo: agentId, status: "active", updatedAt: new Date() })
        .where(eq(conversationsTable.id, conversationId))
        .returning();

      updated = updatedRow;

      // No-op: re-assigning to the same agent — only confirm status, leave counters alone
      if (isSameAgent) return;

      // Decrement previous agent's counter
      if (actualPreviousAgent) {
        await tx
          .update(agentStatusesTable)
          .set({
            activeConversations: sql`GREATEST(0, ${agentStatusesTable.activeConversations} - 1)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentStatusesTable.clerkUserId, actualPreviousAgent),
              eq(agentStatusesTable.tenantId, tenantId),
            ),
          );
      }

      // Increment new agent's counter (upsert — agent may not have a status row yet)
      await tx
        .insert(agentStatusesTable)
        .values({ clerkUserId: agentId, tenantId, activeConversations: 1, status: "busy" })
        .onConflictDoUpdate({
          target: [agentStatusesTable.clerkUserId, agentStatusesTable.tenantId],
          set: {
            activeConversations: sql`${agentStatusesTable.activeConversations} + 1`,
            status: "busy",
            updatedAt: new Date(),
          },
        });
    });

    if (notFound) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    emitToTenant(tenantId, "conversation_updated", { conversation: updated });
    emitToAgent(agentId, "conversation_assigned", { conversation: updated });

    res.json(updated);
  },
);

// ---------------------------------------------------------------------------
// Transfer conversation to another agent or department
// ---------------------------------------------------------------------------
router.post(
  "/tenants/:tenantId/conversations/:conversationId/transfer",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const { toDepartmentId, toAgentId, note } = parsed.data;

    if (!toDepartmentId && !toAgentId) {
      res.status(400).json({ error: "Must specify toDepartmentId or toAgentId" });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Check caller can transfer (must be assigned agent or admin/supervisor)
    const [membership] = await db
      .select({ role: tenantUsersTable.role })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, uid),
        ),
      )
      .limit(1);

    const isAdminOrSupervisor = ["admin", "supervisor"].includes(membership?.role ?? "");

    if (!isAdminOrSupervisor && conv.assignedTo !== uid) {
      res.status(403).json({ error: "Forbidden: can only transfer your own conversations" });
      return;
    }

    const previousAgent = conv.assignedTo;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (toAgentId) {
      // Transfer to specific agent
      const [targetAgent] = await db
        .select()
        .from(tenantUsersTable)
        .where(
          and(
            eq(tenantUsersTable.tenantId, tenantId),
            eq(tenantUsersTable.clerkUserId, toAgentId),
            eq(tenantUsersTable.status, "active"),
          ),
        )
        .limit(1);

      if (!targetAgent) {
        res.status(400).json({ error: "Target agent is not an active member" });
        return;
      }

      updates["assignedTo"] = toAgentId;
      updates["status"] = "active";
      if (toDepartmentId) updates["departmentId"] = toDepartmentId;
    } else if (toDepartmentId) {
      // Transfer to department queue
      const [dept] = await db
        .select({ id: departmentsTable.id })
        .from(departmentsTable)
        .where(
          and(
            eq(departmentsTable.id, toDepartmentId),
            eq(departmentsTable.tenantId, tenantId),
          ),
        )
        .limit(1);

      if (!dept) {
        res.status(404).json({ error: "Department not found in this tenant" });
        return;
      }

      // Get distribution mode settings
      const [settings] = await db
        .select({ distributionMode: channelSettingsTable.distributionMode })
        .from(channelSettingsTable)
        .where(eq(channelSettingsTable.tenantId, tenantId))
        .limit(1);

      const mode = settings?.distributionMode ?? "manual";

      // Transition to 'waiting' in the target department FIRST so that tryAutoAssign
      // finds the conversation in the expected state (waiting + unassigned).
      // Decrement previous agent's counter while we're at it.
      await db.transaction(async (tx) => {
        await tx
          .update(conversationsTable)
          .set({
            departmentId: toDepartmentId,
            status: "waiting",
            assignedTo: null,
            updatedAt: new Date(),
          })
          .where(eq(conversationsTable.id, conversationId));

        if (previousAgent) {
          await tx
            .update(agentStatusesTable)
            .set({
              activeConversations: sql`GREATEST(0, ${agentStatusesTable.activeConversations} - 1)`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(agentStatusesTable.clerkUserId, previousAgent),
                eq(agentStatusesTable.tenantId, tenantId),
              ),
            );
        }
      });

      // Now try auto-assign — conversation is waiting+unassigned and will be found
      const assignedAgent = await tryAutoAssign(tenantId, conversationId, toDepartmentId, mode);

      const [updated] = await db
        .select()
        .from(conversationsTable)
        .where(eq(conversationsTable.id, conversationId))
        .limit(1);

      emitToTenant(tenantId, "conversation_updated", { conversation: updated });
      if (assignedAgent) {
        emitToAgent(assignedAgent, "conversation_assigned", { conversation: updated });
      }

      res.json(updated);
      return;
    }

    // Agent-to-agent transfer path: apply updates and adjust counters
    const [updated] = await db
      .update(conversationsTable)
      .set(updates)
      .where(eq(conversationsTable.id, conversationId))
      .returning();

    // Adjust agent counts
    if (previousAgent) {
      await db
        .update(agentStatusesTable)
        .set({
          activeConversations: sql`GREATEST(0, ${agentStatusesTable.activeConversations} - 1)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentStatusesTable.clerkUserId, previousAgent),
            eq(agentStatusesTable.tenantId, tenantId),
          ),
        );
    }
    if (toAgentId) {
      await db
        .insert(agentStatusesTable)
        .values({ clerkUserId: toAgentId, tenantId, activeConversations: 1, status: "busy" })
        .onConflictDoUpdate({
          target: [agentStatusesTable.clerkUserId, agentStatusesTable.tenantId],
          set: {
            activeConversations: sql`${agentStatusesTable.activeConversations} + 1`,
            updatedAt: new Date(),
          },
        });
      emitToAgent(toAgentId, "conversation_assigned", { conversation: updated });
    }

    emitToTenant(tenantId, "conversation_updated", { conversation: updated });

    res.json(updated);
  },
);

// ---------------------------------------------------------------------------
// Close conversation
// ---------------------------------------------------------------------------
router.post(
  "/tenants/:tenantId/conversations/:conversationId/close",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    const [conv] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Check permissions
    const [membership] = await db
      .select({ role: tenantUsersTable.role })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, uid),
        ),
      )
      .limit(1);

    const isAdminOrSupervisor = ["admin", "supervisor"].includes(membership?.role ?? "");

    if (!isAdminOrSupervisor && conv.assignedTo !== uid) {
      res.status(403).json({ error: "Forbidden: can only close your own conversations" });
      return;
    }

    if (conv.status === "closed") {
      res.status(400).json({ error: "Conversation is already closed" });
      return;
    }

    // Get closing message
    const [settings] = await db
      .select({ closingMessage: channelSettingsTable.closingMessage })
      .from(channelSettingsTable)
      .where(eq(channelSettingsTable.tenantId, tenantId))
      .limit(1);

    // Send closing message to customer
    const contact = await db
      .select({ phone: contactsTable.phone })
      .from(contactsTable)
      .where(eq(contactsTable.id, conv.contactId))
      .then((r) => r[0]);

    if (contact && settings?.closingMessage) {
      const [instance] = await db
        .select({ phoneNumber: whatsappInstancesTable.phoneNumber })
        .from(whatsappInstancesTable)
        .where(eq(whatsappInstancesTable.tenantId, tenantId))
        .limit(1);

      await sendTenantMessage(
        tenantId,
        conversationId,
        contact.phone,
        settings.closingMessage,
        instance?.phoneNumber ?? "",
      ).catch(() => null);
    }

    const [updated] = await db
      .update(conversationsTable)
      .set({
        status: "closed",
        closedAt: new Date(),
        closedBy: uid,
        closingNote: parsed.data.note ?? null,
        updatedAt: new Date(),
      })
      .where(eq(conversationsTable.id, conversationId))
      .returning();

    // Decrement agent's count
    if (conv.assignedTo) {
      await db
        .update(agentStatusesTable)
        .set({
          activeConversations: sql`GREATEST(0, ${agentStatusesTable.activeConversations} - 1)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentStatusesTable.clerkUserId, conv.assignedTo),
            eq(agentStatusesTable.tenantId, tenantId),
          ),
        );
    }

    emitToTenant(tenantId, "conversation_updated", { conversation: updated });

    res.json(updated);
  },
);

export default router;
