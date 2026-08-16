import { Router } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { tenantUsersTable, tenantsTable } from "@workspace/db";
import { eq, and, like } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router = Router();

/**
 * Reconcile any pending invite rows for this user's email.
 * Runs automatically on GET /me so new users are activated immediately
 * after their first sign-in without requiring a separate API call.
 */
async function reconcileInvites(
  userId: string,
  email: string,
): Promise<void> {
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

  for (const invite of pendingInvites) {
    const [existing] = await db
      .select()
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, invite.tenantId),
          eq(tenantUsersTable.clerkUserId, userId),
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
          clerkUserId: userId,
          status: "active",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantUsersTable.tenantId, invite.tenantId),
            eq(tenantUsersTable.clerkUserId, invite.clerkUserId),
          ),
        );
    }
  }
}

/**
 * GET /api/me
 * Returns the authenticated user profile with tenant memberships.
 * Also auto-reconciles any pending email invites on first load.
 */
router.get("/me", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const uid = userId!;

  const clerkUser = await clerkClient.users.getUser(uid);
  const primaryEmail =
    clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "";

  // Auto-reconcile invites so newly signed-up users see their tenants immediately
  if (primaryEmail) {
    await reconcileInvites(uid, primaryEmail);
  }

  const memberships = await db
    .select({
      tenantId: tenantUsersTable.tenantId,
      tenantName: tenantsTable.name,
      tenantSlug: tenantsTable.slug,
      tenantLogoUrl: tenantsTable.logoUrl,
      role: tenantUsersTable.role,
      status: tenantUsersTable.status,
      joinedAt: tenantUsersTable.joinedAt,
      isSuperAdmin: tenantUsersTable.isSuperAdmin,
    })
    .from(tenantUsersTable)
    .innerJoin(tenantsTable, eq(tenantUsersTable.tenantId, tenantsTable.id))
    .where(eq(tenantUsersTable.clerkUserId, uid));

  const isSuperAdmin = memberships.some((m) => m.isSuperAdmin);

  res.json({
    clerkUserId: uid,
    email: primaryEmail,
    firstName: clerkUser.firstName ?? null,
    lastName: clerkUser.lastName ?? null,
    avatarUrl: clerkUser.imageUrl ?? null,
    isSuperAdmin,
    tenants: memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenantName,
      tenantSlug: m.tenantSlug,
      tenantLogoUrl: m.tenantLogoUrl,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    })),
  });
});

/**
 * GET /api/me/tenants
 */
router.get("/me/tenants", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const uid = userId!;

  const memberships = await db
    .select({
      tenantId: tenantUsersTable.tenantId,
      tenantName: tenantsTable.name,
      tenantSlug: tenantsTable.slug,
      tenantLogoUrl: tenantsTable.logoUrl,
      role: tenantUsersTable.role,
      status: tenantUsersTable.status,
      joinedAt: tenantUsersTable.joinedAt,
    })
    .from(tenantUsersTable)
    .innerJoin(tenantsTable, eq(tenantUsersTable.tenantId, tenantsTable.id))
    .where(eq(tenantUsersTable.clerkUserId, uid));

  res.json(memberships);
});

export default router;
