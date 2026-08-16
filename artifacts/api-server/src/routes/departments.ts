import { Router } from "express";
import { db } from "@workspace/db";
import {
  departmentsTable,
  departmentAgentsTable,
  tenantUsersTable,
  insertDepartmentSchema,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";

const router = Router();

const departmentPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const agentAddSchema = z.object({
  clerkUserId: z.string().min(1),
  isPrimary: z.boolean().optional(),
});

/**
 * GET /api/tenants/:tenantId/departments — member
 */
router.get(
  "/tenants/:tenantId/departments",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const rows = await db
      .select({
        id: departmentsTable.id,
        tenantId: departmentsTable.tenantId,
        name: departmentsTable.name,
        description: departmentsTable.description,
        color: departmentsTable.color,
        status: departmentsTable.status,
        createdAt: departmentsTable.createdAt,
        updatedAt: departmentsTable.updatedAt,
        agentCount: sql<number>`count(${departmentAgentsTable.clerkUserId})::int`,
      })
      .from(departmentsTable)
      .leftJoin(
        departmentAgentsTable,
        eq(departmentAgentsTable.departmentId, departmentsTable.id),
      )
      .where(eq(departmentsTable.tenantId, tenantId))
      .groupBy(departmentsTable.id);

    res.json(rows);
  },
);

/**
 * POST /api/tenants/:tenantId/departments — admin only
 */
router.post(
  "/tenants/:tenantId/departments",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const parsed = insertDepartmentSchema.safeParse({ ...req.body, tenantId });
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    const [dept] = await db
      .insert(departmentsTable)
      .values(parsed.data)
      .returning();
    res.status(201).json({ ...dept, agentCount: 0 });
  },
);

/**
 * GET /api/tenants/:tenantId/departments/:departmentId — member
 */
router.get(
  "/tenants/:tenantId/departments/:departmentId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const departmentId = Number(req.params["departmentId"]);

    const [row] = await db
      .select({
        id: departmentsTable.id,
        tenantId: departmentsTable.tenantId,
        name: departmentsTable.name,
        description: departmentsTable.description,
        color: departmentsTable.color,
        status: departmentsTable.status,
        createdAt: departmentsTable.createdAt,
        updatedAt: departmentsTable.updatedAt,
        agentCount: sql<number>`count(${departmentAgentsTable.clerkUserId})::int`,
      })
      .from(departmentsTable)
      .leftJoin(
        departmentAgentsTable,
        eq(departmentAgentsTable.departmentId, departmentsTable.id),
      )
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      )
      .groupBy(departmentsTable.id);

    if (!row) {
      res.status(404).json({ error: "Department not found" });
      return;
    }

    res.json(row);
  },
);

/**
 * PATCH /api/tenants/:tenantId/departments/:departmentId — admin
 */
router.patch(
  "/tenants/:tenantId/departments/:departmentId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const departmentId = Number(req.params["departmentId"]);

    const parsed = departmentPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "At least one field is required" });
      return;
    }

    // Verify department belongs to this tenant before updating
    const [existing] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }

    const { name, description, color, status } = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates["name"] = name;
    if (description !== undefined) updates["description"] = description;
    if (color !== undefined) updates["color"] = color;
    if (status !== undefined) updates["status"] = status;

    const [updated] = await db
      .update(departmentsTable)
      .set(updates)
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      )
      .returning();

    const [agentCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(departmentAgentsTable)
      .where(eq(departmentAgentsTable.departmentId, departmentId));

    res.json({ ...updated, agentCount: agentCountRow?.count ?? 0 });
  },
);

/**
 * DELETE /api/tenants/:tenantId/departments/:departmentId — admin
 */
router.delete(
  "/tenants/:tenantId/departments/:departmentId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const departmentId = Number(req.params["departmentId"]);

    // Verify department belongs to this tenant before deleting
    const [existing] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }

    await db
      .delete(departmentsTable)
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      );

    res.status(204).end();
  },
);

/**
 * POST /api/tenants/:tenantId/departments/:departmentId/agents — admin
 */
router.post(
  "/tenants/:tenantId/departments/:departmentId/agents",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const departmentId = Number(req.params["departmentId"]);

    const parsed = agentAddSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const { clerkUserId, isPrimary = false } = parsed.data;

    // Verify department belongs to this tenant (cross-tenant isolation)
    const [dept] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!dept) {
      res.status(404).json({ error: "Department not found in this tenant" });
      return;
    }

    // Verify target user is an active member of this specific tenant
    const [member] = await db
      .select()
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.clerkUserId, clerkUserId),
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.status, "active"),
        ),
      )
      .limit(1);

    if (!member) {
      res
        .status(400)
        .json({ error: "User is not an active member of this tenant" });
      return;
    }

    const [agent] = await db
      .insert(departmentAgentsTable)
      .values({ departmentId, tenantId, clerkUserId, isPrimary })
      .onConflictDoUpdate({
        target: [
          departmentAgentsTable.departmentId,
          departmentAgentsTable.clerkUserId,
        ],
        set: { isPrimary },
      })
      .returning();

    res.status(201).json({
      departmentId: agent?.departmentId,
      clerkUserId: agent?.clerkUserId,
      email: member.email,
      firstName: member.firstName ?? null,
      lastName: member.lastName ?? null,
      isPrimary: agent?.isPrimary ?? false,
      addedAt: agent?.addedAt,
    });
  },
);

/**
 * DELETE /api/tenants/:tenantId/departments/:departmentId/agents/:userId — admin
 */
router.delete(
  "/tenants/:tenantId/departments/:departmentId/agents/:userId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const departmentId = Number(req.params["departmentId"]);
    const userId = String(req.params["userId"]);

    // Verify department belongs to this tenant before removing agent
    const [dept] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(
        and(
          eq(departmentsTable.id, departmentId),
          eq(departmentsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!dept) {
      res.status(404).json({ error: "Department not found in this tenant" });
      return;
    }

    await db
      .delete(departmentAgentsTable)
      .where(
        and(
          eq(departmentAgentsTable.departmentId, departmentId),
          eq(departmentAgentsTable.clerkUserId, userId),
          eq(departmentAgentsTable.tenantId, tenantId),
        ),
      );

    res.status(204).end();
  },
);

export default router;
