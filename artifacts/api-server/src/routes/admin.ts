import { Router } from "express";
import { db } from "@workspace/db";
import {
  tenantsTable,
  tenantUsersTable,
  departmentsTable,
} from "@workspace/db";
import { eq, sql, gte } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/auth";

const router = Router();

/**
 * GET /api/admin/stats — super admin only
 */
router.get("/admin/stats", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [totalTenants, activeTenants, suspendedTenants, totalUsers, totalDepartments, newThisMonth] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(tenantsTable).then(r => r[0]?.count ?? 0),
      db.select({ count: sql<number>`count(*)::int` }).from(tenantsTable).where(eq(tenantsTable.status, "active")).then(r => r[0]?.count ?? 0),
      db.select({ count: sql<number>`count(*)::int` }).from(tenantsTable).where(eq(tenantsTable.status, "suspended")).then(r => r[0]?.count ?? 0),
      db.select({ count: sql<number>`count(*)::int` }).from(tenantUsersTable).then(r => r[0]?.count ?? 0),
      db.select({ count: sql<number>`count(*)::int` }).from(departmentsTable).then(r => r[0]?.count ?? 0),
      db.select({ count: sql<number>`count(*)::int` }).from(tenantsTable).where(gte(tenantsTable.createdAt, startOfMonth)).then(r => r[0]?.count ?? 0),
    ]);

  res.json({ totalTenants, activeTenants, suspendedTenants, totalUsers, totalDepartments, newTenantsThisMonth: newThisMonth });
});

/**
 * GET /api/admin/tenants/recent — super admin only
 */
router.get("/admin/tenants/recent", requireAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const tenants = await db
    .select()
    .from(tenantsTable)
    .orderBy(sql`${tenantsTable.createdAt} desc`)
    .limit(10);

  res.json(tenants);
});

export default router;
