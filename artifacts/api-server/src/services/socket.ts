/**
 * Socket.io singleton — initialized once in index.ts.
 *
 * Security model:
 *   - Every connection is authenticated via Clerk session token (cookie or
 *     explicit `auth.token`). Unauthenticated connections are rejected.
 *   - `join_tenant` verifies the caller is an active member (or super admin)
 *     of the requested tenant via a DB lookup.
 *   - `join_agent` joins the per-agent room using the server-verified userId,
 *     never a client-supplied string.
 *
 * Room naming:
 *   tenant:{tenantId}   — all verified agents/supervisors in a tenant
 *   agent:{userId}      — targeted notifications for a specific agent
 */
import { type Server as HttpServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { verifyToken } from "@clerk/express";
import { db } from "@workspace/db";
import { tenantUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

let _io: SocketIOServer | null = null;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function parseCookieValue(header: string, name: string): string | null {
  const match = header.match(
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]!) : null;
}

async function verifyClerkToken(token: string): Promise<string | null> {
  try {
    const payload = await verifyToken(token, {
      secretKey: process.env["CLERK_SECRET_KEY"],
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initSocket(httpServer: HttpServer): SocketIOServer {
  const trustedOrigins: string[] = [];

  (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .forEach((o) => trustedOrigins.push(o));

  if (
    process.env["NODE_ENV"] !== "production" &&
    process.env["REPLIT_DEV_DOMAIN"]
  ) {
    trustedOrigins.push(`https://${process.env["REPLIT_DEV_DOMAIN"]}`);
  }

  _io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    cors: {
      origin:
        trustedOrigins.length > 0
          ? trustedOrigins
          : process.env["NODE_ENV"] !== "production"
            ? true
            : false,
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // ---------------------------------------------------------------------------
  // Auth middleware — verify Clerk session before accepting the connection
  // ---------------------------------------------------------------------------
  _io.use(async (socket, next) => {
    // 1. Explicit token from socket handshake auth (preferred)
    const authToken = socket.handshake.auth?.token as string | undefined;

    // 2. Session cookie (Clerk sets __session or __clerk_db_jwt)
    const cookieHeader = socket.handshake.headers.cookie ?? "";
    const cookieToken =
      parseCookieValue(cookieHeader, "__session") ??
      parseCookieValue(cookieHeader, "__clerk_db_jwt");

    const token = authToken || cookieToken;

    if (!token) {
      return next(new Error("Unauthorized: no session token"));
    }

    const userId = await verifyClerkToken(token);
    if (!userId) {
      return next(new Error("Unauthorized: invalid or expired token"));
    }

    socket.data["userId"] = userId;
    next();
  });

  _io.on("connection", (socket) => handleConnection(socket));

  return _io;
}

// ---------------------------------------------------------------------------
// Connection handler
// ---------------------------------------------------------------------------

function handleConnection(socket: Socket): void {
  const userId = socket.data["userId"] as string;

  // Automatically join the per-agent room using server-verified userId
  void socket.join(`agent:${userId}`);

  socket.on("join_tenant", async (tenantId: unknown) => {
    if (typeof tenantId !== "number" || !Number.isInteger(tenantId) || tenantId <= 0) {
      return;
    }

    // Verify the authenticated user is an active member (or super admin) of this tenant
    const [tenantMember] = await db
      .select({
        isSuperAdmin: tenantUsersTable.isSuperAdmin,
        status: tenantUsersTable.status,
        tenantId: tenantUsersTable.tenantId,
      })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.clerkUserId, userId),
          eq(tenantUsersTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    const isSuperAdmin = tenantMember?.isSuperAdmin === true;
    const isActiveMember = tenantMember && tenantMember.status === "active";

    if (!isActiveMember && !isSuperAdmin) {
      // Silently ignore unauthorized join attempts
      return;
    }

    void socket.join(`tenant:${tenantId}`);
  });

  socket.on("leave_tenant", (tenantId: unknown) => {
    if (typeof tenantId === "number" && tenantId > 0) {
      void socket.leave(`tenant:${tenantId}`);
    }
  });

  // join_agent is kept for API compatibility but now uses the server-verified userId
  // The value from the client is intentionally ignored
  socket.on("join_agent", () => {
    // Already joined agent room on connection — this is a no-op but kept for
    // backwards compatibility so the client doesn't need to change
  });
}

// ---------------------------------------------------------------------------
// Typed emit helpers
// ---------------------------------------------------------------------------

export function getIo(): SocketIOServer {
  if (!_io) {
    throw new Error("Socket.io not initialized. Call initSocket() first.");
  }
  return _io;
}

export function emitToTenant(
  tenantId: number,
  event: string,
  data: unknown,
): void {
  try {
    getIo().to(`tenant:${tenantId}`).emit(event, data);
  } catch {
    // Socket may not be initialized in test environments
  }
}

export function emitToAgent(
  clerkUserId: string,
  event: string,
  data: unknown,
): void {
  try {
    getIo().to(`agent:${clerkUserId}`).emit(event, data);
  } catch {
    // Socket may not be initialized
  }
}
