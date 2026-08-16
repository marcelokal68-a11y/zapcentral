/**
 * Onboarding and reconciliation routes.
 *
 * Bootstrap flow (one-time platform setup):
 *   POST /api/onboard/super-admin  — requires X-Bootstrap-Secret header matching
 *   BOOTSTRAP_SECRET env var.  Uses an atomic DB-layer claim via `platform_config`
 *   unique key to prevent concurrent bootstraps.
 *
 * Invite claim flow:
 *   POST /api/onboard/claim-invites — reconciles pending invite rows whose email
 *   matches the caller's Clerk email.  Also called automatically by GET /api/me.
 */
import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import {
  tenantUsersTable,
  tenantsTable,
  platformConfigTable,
  insertTenantSchema,
} from "@workspace/db";
import { eq, and, like } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// ---------------------------------------------------------------------------
// Bootstrap secret guard
// ---------------------------------------------------------------------------
function checkBootstrapSecret(
  req: import("express").Request,
  res: import("express").Response,
): boolean {
  const configured = process.env["BOOTSTRAP_SECRET"];
  if (!configured) {
    res.status(503).json({
      error:
        "Bootstrap is disabled. Set BOOTSTRAP_SECRET to enable first-admin provisioning.",
    });
    return false;
  }
  const provided =
    req.headers["x-bootstrap-secret"] ??
    (req.body as Record<string, unknown>)?.["bootstrapSecret"];
  if (provided !== configured) {
    res.status(403).json({ error: "Invalid bootstrap secret" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/onboard/super-admin
// ---------------------------------------------------------------------------
router.post(
  "/onboard/super-admin",
  requireAuth,
  async (req, res): Promise<void> => {
    if (!checkBootstrapSecret(req, res)) return;

    const { userId } = getAuth(req);
    const uid = userId!;

    // -----------------------------------------------------------------------
    // Fetch Clerk user data BEFORE any DB work so that a Clerk API failure
    // leaves the database untouched and a retry can succeed cleanly.
    // -----------------------------------------------------------------------
    const clerkUser = await clerkClient.users.getUser(uid);
    const email =
      clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "";

    // -----------------------------------------------------------------------
    // Wrap all DB mutations in a single transaction so the atomic claim, system
    // tenant creation, and super-admin membership are committed together or not
    // at all. A failure at any step rolls back the claim, making a retry safe.
    // -----------------------------------------------------------------------
    let alreadyExists = false;
    await db.transaction(async (tx) => {
      // Atomic one-time claim: unique index on `key` ensures only one winner
      const claimed = await tx
        .insert(platformConfigTable)
        .values({ key: "super_admin_bootstrapped", value: uid })
        .onConflictDoNothing()
        .returning();

      if (claimed.length === 0) {
        alreadyExists = true;
        return; // transaction is read-only here — nothing to roll back
      }

      // Provision system tenant (idempotent by slug)
      let systemTenant = await tx
        .select()
        .from(tenantsTable)
        .where(eq(tenantsTable.slug, "system"))
        .then((r) => r[0]);

      if (!systemTenant) {
        const parsed = insertTenantSchema.safeParse({
          name: "System",
          slug: "system",
          planType: "enterprise",
          status: "active",
          maxAgents: 9999,
        });
        if (!parsed.success) throw new Error("Invalid system tenant data");
        [systemTenant] = await tx
          .insert(tenantsTable)
          .values(parsed.data)
          .returning();
      }

      if (!systemTenant) throw new Error("Failed to provision system tenant");

      await tx
        .insert(tenantUsersTable)
        .values({
          tenantId: systemTenant.id,
          clerkUserId: uid,
          email,
          firstName: clerkUser.firstName ?? null,
          lastName: clerkUser.lastName ?? null,
          avatarUrl: clerkUser.imageUrl ?? null,
          role: "admin",
          status: "active",
          isSuperAdmin: true,
        })
        .onConflictDoUpdate({
          target: [tenantUsersTable.tenantId, tenantUsersTable.clerkUserId],
          set: { isSuperAdmin: true, status: "active", email },
        });
    });

    if (alreadyExists) {
      res.status(409).json({
        error: "A super admin has already been provisioned.",
      });
      return;
    }

    res.status(201).json({ message: "Super admin provisioned successfully" });
  },
);

// ---------------------------------------------------------------------------
// POST /api/onboard/claim-invites
// ---------------------------------------------------------------------------
router.post(
  "/onboard/claim-invites",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = getAuth(req);
    const uid = userId!;

    const clerkUser = await clerkClient.users.getUser(uid);
    const email =
      clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId,
      )?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "";

    if (!email) {
      res.status(400).json({ error: "No primary email on Clerk user" });
      return;
    }

    const pendingInvites = await db
      .select()
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.email, email),
          eq(tenantUsersTable.status, "invited"),
          like(tenantUsersTable.clerkUserId, "invite_%"),
        ),
      );

    const claimedTenants: number[] = [];
    for (const invite of pendingInvites) {
      const [existing] = await db
        .select()
        .from(tenantUsersTable)
        .where(
          and(
            eq(tenantUsersTable.tenantId, invite.tenantId),
            eq(tenantUsersTable.clerkUserId, uid),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .delete(tenantUsersTable)
          .where(
            and(
              eq(tenantUsersTable.tenantId, invite.tenantId),
              eq(tenantUsersTable.clerkUserId, invite.clerkUserId),
            ),
          );
      } else {
        await db
          .update(tenantUsersTable)
          .set({
            clerkUserId: uid,
            status: "active",
            firstName: clerkUser.firstName ?? invite.firstName,
            lastName: clerkUser.lastName ?? invite.lastName,
            avatarUrl: clerkUser.imageUrl ?? invite.avatarUrl,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tenantUsersTable.tenantId, invite.tenantId),
              eq(tenantUsersTable.clerkUserId, invite.clerkUserId),
            ),
          );
        claimedTenants.push(invite.tenantId);
      }
    }

    res.json({ claimedTenants });
  },
);

export default router;
