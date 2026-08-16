import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import {
  tenantUsersTable,
  departmentAgentsTable,
  departmentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";

const router = Router();

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "supervisor", "agent"]),
});

const userPatchSchema = z.object({
  role: z.enum(["admin", "supervisor", "agent"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

/**
 * GET /api/tenants/:tenantId/users — tenant member
 */
router.get(
  "/tenants/:tenantId/users",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const users = await db
      .select()
      .from(tenantUsersTable)
      .where(eq(tenantUsersTable.tenantId, tenantId));

    const enriched = await Promise.all(
      users.map(async (u) => {
        const depts = await db
          .select({ name: departmentsTable.name })
          .from(departmentAgentsTable)
          .innerJoin(
            departmentsTable,
            eq(departmentAgentsTable.departmentId, departmentsTable.id),
          )
          .where(
            and(
              eq(departmentAgentsTable.clerkUserId, u.clerkUserId),
              eq(departmentAgentsTable.tenantId, tenantId),
            ),
          );

        return {
          clerkUserId: u.clerkUserId,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          avatarUrl: u.avatarUrl,
          role: u.role,
          status: u.status,
          departments: depts.map((d) => d.name),
          joinedAt: u.joinedAt,
        };
      }),
    );

    res.json(enriched);
  },
);

/**
 * POST /api/tenants/:tenantId/users/invite — admin only
 * Creates a Clerk invitation and a pending membership record.
 * When the invited user signs up via Clerk and calls GET /api/me,
 * the invite is automatically reconciled (placeholder → real userId, status → active).
 */
router.post(
  "/tenants/:tenantId/users/invite",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const { email, role } = parsed.data;

    // Check if user is already a member (by email)
    const [alreadyMember] = await db
      .select()
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.email, email),
        ),
      )
      .limit(1);

    if (alreadyMember && alreadyMember.status !== "invited") {
      res
        .status(409)
        .json({ error: "User is already a member of this tenant" });
      return;
    }

    // Send a real Clerk invitation email
    let clerkInvitationId: string | null = null;
    try {
      const invitation = await clerkClient.invitations.createInvitation({
        emailAddress: email,
        ignoreExisting: true,
      });
      clerkInvitationId = invitation.id;
    } catch {
      // Non-fatal: Clerk invitation may fail for existing Clerk users;
      // the pending membership record still allows claim-invites reconciliation.
    }

    // Upsert a pending invite record
    const inviteToken = `invite_${tenantId}_${Date.now()}`;
    const [user] = await db
      .insert(tenantUsersTable)
      .values({
        tenantId,
        clerkUserId: alreadyMember?.clerkUserId ?? inviteToken,
        email,
        role,
        status: "invited",
      })
      .onConflictDoUpdate({
        target: [tenantUsersTable.tenantId, tenantUsersTable.clerkUserId],
        set: { role, status: "invited", email, updatedAt: new Date() },
      })
      .returning();

    res.status(201).json({
      ...user,
      departments: [],
      clerkInvitationId,
    });
  },
);

/**
 * PATCH /api/tenants/:tenantId/users/:userId — admin only
 */
router.patch(
  "/tenants/:tenantId/users/:userId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const userId = String(req.params["userId"]);
    const { userId: callerId } = getAuth(req);

    if (userId === callerId) {
      res.status(400).json({ error: "Cannot modify your own role or status" });
      return;
    }

    const parsed = userPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    const { role, status } = parsed.data;

    if (role === undefined && status === undefined) {
      res.status(400).json({ error: "At least one of role or status is required" });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (role !== undefined) updates["role"] = role;
    if (status !== undefined) updates["status"] = status;

    const [updated] = await db
      .update(tenantUsersTable)
      .set(updates)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, userId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found in tenant" });
      return;
    }

    res.json({ ...updated, departments: [] });
  },
);

/**
 * DELETE /api/tenants/:tenantId/users/:userId — admin only
 */
router.delete(
  "/tenants/:tenantId/users/:userId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const userId = String(req.params["userId"]);
    const { userId: callerId } = getAuth(req);

    if (userId === callerId) {
      res.status(400).json({ error: "Cannot remove yourself from tenant" });
      return;
    }

    await db
      .delete(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, userId),
        ),
      );

    await db
      .delete(departmentAgentsTable)
      .where(
        and(
          eq(departmentAgentsTable.tenantId, tenantId),
          eq(departmentAgentsTable.clerkUserId, userId),
        ),
      );

    res.status(204).end();
  },
);

export default router;
