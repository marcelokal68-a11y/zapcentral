/**
 * Agent status routes.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { agentStatusesTable, tenantUsersTable, conversationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireTenantMember } from "../middlewares/auth";
import { emitToTenant } from "../services/socket";

const router = Router();

const statusUpdateSchema = z.object({
  status: z.enum(["available", "busy", "away", "offline"]),
  maxConversations: z.number().int().min(1).max(50).optional(),
});

/**
 * GET /api/tenants/:tenantId/agents/status
 * Lists all agents with their current status.
 */
router.get(
  "/tenants/:tenantId/agents/status",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const agents = await db
      .select({
        clerkUserId: tenantUsersTable.clerkUserId,
        firstName: tenantUsersTable.firstName,
        lastName: tenantUsersTable.lastName,
        email: tenantUsersTable.email,
        avatarUrl: tenantUsersTable.avatarUrl,
        role: tenantUsersTable.role,
        status: agentStatusesTable.status,
        maxConversations: agentStatusesTable.maxConversations,
        activeConversations: agentStatusesTable.activeConversations,
      })
      .from(tenantUsersTable)
      .leftJoin(
        agentStatusesTable,
        and(
          eq(agentStatusesTable.clerkUserId, tenantUsersTable.clerkUserId),
          eq(agentStatusesTable.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.status, "active"),
        ),
      );

    const result = agents.map((a) => ({
      ...a,
      status: a.status ?? "offline",
      maxConversations: a.maxConversations ?? 5,
      activeConversations: a.activeConversations ?? 0,
    }));

    res.json(result);
  },
);

/**
 * GET /api/tenants/:tenantId/agents/me/status
 * Get the current user's agent status.
 */
router.get(
  "/tenants/:tenantId/agents/me/status",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    const [statusRow] = await db
      .select()
      .from(agentStatusesTable)
      .where(
        and(
          eq(agentStatusesTable.clerkUserId, uid),
          eq(agentStatusesTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    res.json(
      statusRow ?? {
        clerkUserId: uid,
        tenantId,
        status: "offline",
        maxConversations: 5,
        activeConversations: 0,
      },
    );
  },
);

/**
 * PATCH /api/tenants/:tenantId/agents/me/status
 * Update the current user's agent status.
 */
router.patch(
  "/tenants/:tenantId/agents/me/status",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    const { status, maxConversations } = parsed.data;

    // Count active conversations for this agent
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.tenantId, tenantId),
          eq(conversationsTable.assignedTo, uid),
          eq(conversationsTable.status, "active"),
        ),
      );

    const [updated] = await db
      .insert(agentStatusesTable)
      .values({
        clerkUserId: uid,
        tenantId,
        status,
        maxConversations: maxConversations ?? 5,
        activeConversations: countResult?.count ?? 0,
      })
      .onConflictDoUpdate({
        target: [agentStatusesTable.clerkUserId, agentStatusesTable.tenantId],
        set: {
          status,
          maxConversations: maxConversations ?? undefined,
          activeConversations: countResult?.count ?? 0,
          updatedAt: new Date(),
        },
      })
      .returning();

    emitToTenant(tenantId, "agent_status_updated", {
      clerkUserId: uid,
      tenantId,
      status,
    });

    res.json(updated);
  },
);

export default router;
