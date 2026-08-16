import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  tenantUsersTable,
  departmentsTable,
  insertTenantSchema,
} from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireSuperAdmin,
  requireTenantMember,
} from "../middlewares/auth";

const router = Router();

// Branding-only fields any active tenant admin may change
const tenantBrandingPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  logoUrl: z.string().url().nullable().optional(),
});

// Platform/billing fields only a super admin may change
const tenantPlatformPatchSchema = z.object({
  planType: z.enum(["trial", "starter", "professional", "enterprise"]).optional(),
  maxAgents: z.number().int().min(1).max(10000).optional(),
  status: z.enum(["active", "suspended", "pending"]).optional(),
});

const tenantPatchSchema = tenantBrandingPatchSchema.merge(tenantPlatformPatchSchema);

// User role/status patch used by user routes (defined once, imported by type)
const userPatchSchema = z.object({
  role: z.enum(["admin", "supervisor", "agent"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export { userPatchSchema };

/**
 * GET /api/tenants — super admin only
 */
router.get(
  "/tenants",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const page = Number(req.query["page"] ?? 1);
    const limit = Number(req.query["limit"] ?? 20);
    const offset = (page - 1) * limit;

    const [tenants, countResult] = await Promise.all([
      db.select().from(tenantsTable).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(tenantsTable),
    ]);

    res.json({
      tenants,
      total: countResult[0]?.count ?? 0,
      page,
      limit,
    });
  },
);

/**
 * POST /api/tenants — super admin only
 */
router.post(
  "/tenants",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const parsed = insertTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    const [tenant] = await db
      .insert(tenantsTable)
      .values(parsed.data)
      .returning();

    res.status(201).json(tenant);
  },
);

/**
 * GET /api/tenants/:tenantId — tenant member or super admin
 */
router.get(
  "/tenants/:tenantId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const [tenant] = await db
      .select()
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    res.json(tenant);
  },
);

/**
 * PATCH /api/tenants/:tenantId
 *
 * Tenant admins may update branding only (name, logoUrl).
 * Super admins may additionally change planType, maxAgents, and status.
 *
 * Authorization is resolved against both `clerkUserId` AND `tenantId` to
 * prevent cross-tenant privilege escalation.
 * All inputs are validated with Zod before any database write.
 */
router.patch(
  "/tenants/:tenantId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    // Validate the entire request body first
    const parsed = tenantPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    // Resolve caller's role scoped to THIS specific tenant
    const [tenantMembership] = await db
      .select({
        role: tenantUsersTable.role,
        status: tenantUsersTable.status,
      })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.clerkUserId, uid),
          eq(tenantUsersTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    // Check platform-level super admin (any membership with isSuperAdmin=true)
    const [superAdminRow] = await db
      .select({ isSuperAdmin: tenantUsersTable.isSuperAdmin })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.clerkUserId, uid),
          eq(tenantUsersTable.isSuperAdmin, true),
        ),
      )
      .limit(1);

    const callerIsSuperAdmin = superAdminRow?.isSuperAdmin === true;

    // Must be an active admin/supervisor in this tenant, or a super admin
    if (
      !callerIsSuperAdmin &&
      (!tenantMembership ||
        !["admin", "supervisor"].includes(tenantMembership.role) ||
        tenantMembership.status === "suspended")
    ) {
      res.status(403).json({ error: "Forbidden: admin role required" });
      return;
    }

    const { name, logoUrl, planType, maxAgents, status } = parsed.data;

    // Platform/billing fields — super admin only
    if (
      (planType !== undefined || maxAgents !== undefined || status !== undefined) &&
      !callerIsSuperAdmin
    ) {
      res.status(403).json({
        error:
          "Forbidden: planType, maxAgents, and status can only be changed by a super admin",
      });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates["name"] = name;
    if (logoUrl !== undefined) updates["logoUrl"] = logoUrl;
    if (callerIsSuperAdmin) {
      if (planType !== undefined) updates["planType"] = planType;
      if (maxAgents !== undefined) updates["maxAgents"] = maxAgents;
      if (status !== undefined) updates["status"] = status;
    }

    const [updated] = await db
      .update(tenantsTable)
      .set(updates)
      .where(eq(tenantsTable.id, tenantId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    res.json(updated);
  },
);

/**
 * DELETE /api/tenants/:tenantId — super admin only
 */
router.delete(
  "/tenants/:tenantId",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    await db
      .update(tenantsTable)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(tenantsTable.id, tenantId));

    res.status(204).end();
  },
);

/**
 * GET /api/tenants/:tenantId/stats — tenant member
 */
router.get(
  "/tenants/:tenantId/stats",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const [tenant, usersResult, deptResult, activeDeptResult] =
      await Promise.all([
        db
          .select()
          .from(tenantsTable)
          .where(eq(tenantsTable.id, tenantId))
          .then((r) => r[0]),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(tenantUsersTable)
          .where(eq(tenantUsersTable.tenantId, tenantId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(departmentsTable)
          .where(eq(departmentsTable.tenantId, tenantId)),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(departmentsTable)
          .where(
            and(
              eq(departmentsTable.tenantId, tenantId),
              eq(departmentsTable.status, "active"),
            ),
          ),
      ]);

    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    res.json({
      totalUsers: usersResult[0]?.count ?? 0,
      activeAgents: usersResult[0]?.count ?? 0,
      totalDepartments: deptResult[0]?.count ?? 0,
      activeDepartments: activeDeptResult[0]?.count ?? 0,
      planType: tenant.planType,
      maxAgents: tenant.maxAgents,
    });
  },
);

export default router;
