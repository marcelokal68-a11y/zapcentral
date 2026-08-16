import { type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { tenantUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/** Require a valid Clerk session. Returns 401 if not authenticated. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Check whether the authenticated user is a platform super admin
 * (has isSuperAdmin=true in any tenant membership).
 */
async function isSuperAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isSuperAdmin: tenantUsersTable.isSuperAdmin })
    .from(tenantUsersTable)
    .where(
      and(
        eq(tenantUsersTable.clerkUserId, userId),
        eq(tenantUsersTable.isSuperAdmin, true),
      ),
    )
    .limit(1);
  return row?.isSuperAdmin === true;
}

/** Require the authenticated user to be a platform super admin. */
export async function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!(await isSuperAdmin(userId))) {
    res.status(403).json({ error: "Forbidden: super admin access required" });
    return;
  }

  next();
}

/**
 * Require the authenticated user to be an active member of the tenant
 * identified by `req.params.tenantId`.
 * Super admins bypass the membership check.
 * Attaches `req.tenantMembership` when a real membership record is found.
 */
export async function requireTenantMember(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tenantId = Number(req.params["tenantId"]);
  if (isNaN(tenantId)) {
    res.status(400).json({ error: "Invalid tenant ID" });
    return;
  }

  // Super admins may access any tenant without a membership record
  if (await isSuperAdmin(userId)) {
    next();
    return;
  }

  const [membership] = await db
    .select()
    .from(tenantUsersTable)
    .where(
      and(
        eq(tenantUsersTable.tenantId, tenantId),
        eq(tenantUsersTable.clerkUserId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    res.status(403).json({ error: "Forbidden: not a member of this tenant" });
    return;
  }

  if (membership.status === "suspended") {
    res.status(403).json({ error: "Forbidden: your membership is suspended" });
    return;
  }

  (req as Request & { tenantMembership: typeof membership }).tenantMembership =
    membership;
  next();
}

/**
 * Require the authenticated user to be an active admin or supervisor of the
 * tenant. Must be used after `requireTenantMember` (or standalone — it
 * re-queries for safety). Super admins bypass the role check.
 */
export async function requireTenantAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tenantId = Number(req.params["tenantId"]);
  if (isNaN(tenantId)) {
    res.status(400).json({ error: "Invalid tenant ID" });
    return;
  }

  // Super admins bypass role restrictions
  if (await isSuperAdmin(userId)) {
    next();
    return;
  }

  const [membership] = await db
    .select({ role: tenantUsersTable.role, status: tenantUsersTable.status })
    .from(tenantUsersTable)
    .where(
      and(
        eq(tenantUsersTable.tenantId, tenantId),
        eq(tenantUsersTable.clerkUserId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    res.status(403).json({ error: "Forbidden: not a member of this tenant" });
    return;
  }

  if (membership.status === "suspended") {
    res.status(403).json({ error: "Forbidden: your membership is suspended" });
    return;
  }

  if (!["admin", "supervisor"].includes(membership.role)) {
    res.status(403).json({
      error: "Forbidden: admin or supervisor role required",
    });
    return;
  }

  next();
}

/** Resolve a user's primary email from Clerk. Returns null on failure. */
export async function getClerkUserEmail(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    return primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  } catch {
    return null;
  }
}
