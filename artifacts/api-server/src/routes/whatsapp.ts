/**
 * WhatsApp instance management per tenant.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { whatsappInstancesTable, tenantsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  createInstance,
  deleteInstance,
  getQrCode,
  getConnectionState,
  logoutInstance,
  isEvolutionConfigured,
} from "../services/evolution";
import { emitToTenant } from "../services/socket";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";

const router = Router();

function getWebhookUrl(req: import("express").Request, instanceName: string): string {
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  const base = devDomain
    ? `https://${devDomain}/api-server`
    : `${req.protocol}://${req.get("host")}`;
  return `${base}/api/webhooks/evolution/${instanceName}`;
}

/**
 * GET /api/public/wa-link/:token
 * Public endpoint (no auth) used by the shareable QR page.
 * The token is an unguessable per-tenant share token (revocable by
 * regenerating). Returns only the tenant's display name, connected
 * WhatsApp number and the QR attribution marker.
 */
router.get("/public/wa-link/:token", async (req, res): Promise<void> => {
  const token = String(req.params["token"] ?? "");
  if (!/^[a-f0-9]{32,64}$/.test(token)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [row] = await db
    .select({
      tenantName: tenantsTable.name,
      phoneNumber: whatsappInstancesTable.phoneNumber,
      status: whatsappInstancesTable.status,
    })
    .from(tenantsTable)
    .leftJoin(
      whatsappInstancesTable,
      eq(whatsappInstancesTable.tenantId, tenantsTable.id),
    )
    .where(eq(tenantsTable.qrShareToken, token))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const connected = row.status === "connected" && !!row.phoneNumber;
  res.json({
    tenantName: row.tenantName,
    connected,
    phoneNumber: connected ? row.phoneNumber : null,
    // Short marker appended to the pre-filled message so the webhook can
    // attribute the first inbound message to the QR channel.
    qrMarker: `QR-${token.slice(0, 6)}`,
  });
});

/**
 * GET /api/tenants/:tenantId/whatsapp/qr-share
 * Returns (generating on first call) the tenant's public QR share token.
 * POST .../qr-share/rotate regenerates it, invalidating the old link.
 */
async function generateShareToken(tenantId: number): Promise<string> {
  const token = randomBytes(24).toString("hex");
  await db
    .update(tenantsTable)
    .set({ qrShareToken: token, updatedAt: new Date() })
    .where(eq(tenantsTable.id, tenantId));
  return token;
}

router.get(
  "/tenants/:tenantId/whatsapp/qr-share",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const [tenant] = await db
      .select({ qrShareToken: tenantsTable.qrShareToken })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId))
      .limit(1);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const token = tenant.qrShareToken ?? (await generateShareToken(tenantId));
    res.json({ token });
  },
);

router.post(
  "/tenants/:tenantId/whatsapp/qr-share/rotate",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const token = await generateShareToken(tenantId);
    res.json({ token });
  },
);

/**
 * GET /api/tenants/:tenantId/whatsapp/status
 * Returns current connection status (member access).
 */
router.get(
  "/tenants/:tenantId/whatsapp/status",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const [instance] = await db
      .select({
        id: whatsappInstancesTable.id,
        instanceName: whatsappInstancesTable.instanceName,
        phoneNumber: whatsappInstancesTable.phoneNumber,
        status: whatsappInstancesTable.status,
        lastConnectedAt: whatsappInstancesTable.lastConnectedAt,
        createdAt: whatsappInstancesTable.createdAt,
      })
      .from(whatsappInstancesTable)
      .where(eq(whatsappInstancesTable.tenantId, tenantId))
      .limit(1);

    res.json({
      instance: instance ?? null,
      evolutionConfigured: isEvolutionConfigured(),
    });
  },
);

/**
 * POST /api/tenants/:tenantId/whatsapp/connect
 * Creates (or reconnects) the tenant's WhatsApp instance.
 */
router.post(
  "/tenants/:tenantId/whatsapp/connect",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    if (!isEvolutionConfigured()) {
      res.status(503).json({
        error:
          "Evolution API is not configured. Set EVOLUTION_API_URL and EVOLUTION_API_KEY.",
      });
      return;
    }

    // Check if instance already exists
    const [existing] = await db
      .select()
      .from(whatsappInstancesTable)
      .where(eq(whatsappInstancesTable.tenantId, tenantId))
      .limit(1);

    const instanceName = existing?.instanceName ?? `tenant_${tenantId}`;
    const webhookSecret = existing?.webhookSecret ?? randomBytes(24).toString("hex");
    const webhookUrl = getWebhookUrl(req, instanceName);

    if (!existing) {
      // Create new instance in Evolution API
      await createInstance(instanceName, webhookUrl, webhookSecret);

      await db.insert(whatsappInstancesTable).values({
        tenantId,
        instanceName,
        webhookSecret,
        status: "connecting",
      });
    } else {
      // Reconnect existing instance — just request a new QR
      await db
        .update(whatsappInstancesTable)
        .set({ status: "connecting", qrCode: null, updatedAt: new Date() })
        .where(eq(whatsappInstancesTable.id, existing.id));
    }

    // Fetch QR code
    try {
      const qr = await getQrCode(instanceName);
      const qrCode = qr.base64 ?? qr.code;
      await db
        .update(whatsappInstancesTable)
        .set({
          qrCode,
          qrExpiresAt: new Date(Date.now() + 60_000),
          updatedAt: new Date(),
        })
        .where(eq(whatsappInstancesTable.instanceName, instanceName));

      emitToTenant(tenantId, "whatsapp_qr_updated", { tenantId, qrCode });
    } catch {
      // QR not available immediately — will arrive via webhook
    }

    const [updated] = await db
      .select({
        id: whatsappInstancesTable.id,
        instanceName: whatsappInstancesTable.instanceName,
        status: whatsappInstancesTable.status,
        qrCode: whatsappInstancesTable.qrCode,
        qrExpiresAt: whatsappInstancesTable.qrExpiresAt,
      })
      .from(whatsappInstancesTable)
      .where(eq(whatsappInstancesTable.instanceName, instanceName))
      .limit(1);

    res.json(updated);
  },
);

/**
 * GET /api/tenants/:tenantId/whatsapp/qr
 * Polls for the latest QR code (admin only).
 */
router.get(
  "/tenants/:tenantId/whatsapp/qr",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const [instance] = await db
      .select({
        instanceName: whatsappInstancesTable.instanceName,
        status: whatsappInstancesTable.status,
        qrCode: whatsappInstancesTable.qrCode,
        qrExpiresAt: whatsappInstancesTable.qrExpiresAt,
        phoneNumber: whatsappInstancesTable.phoneNumber,
      })
      .from(whatsappInstancesTable)
      .where(eq(whatsappInstancesTable.tenantId, tenantId))
      .limit(1);

    if (!instance) {
      res.status(404).json({ error: "No WhatsApp instance configured for this tenant" });
      return;
    }

    // If already connected, no QR needed
    if (instance.status === "connected") {
      res.json({ status: "connected", phoneNumber: instance.phoneNumber });
      return;
    }

    // Try to refresh QR from Evolution API
    if (isEvolutionConfigured() && !instance.qrCode) {
      try {
        const qr = await getQrCode(instance.instanceName);
        const qrCode = qr.base64 ?? qr.code;
        if (qrCode) {
          await db
            .update(whatsappInstancesTable)
            .set({
              qrCode,
              qrExpiresAt: new Date(Date.now() + 60_000),
              updatedAt: new Date(),
            })
            .where(eq(whatsappInstancesTable.instanceName, instance.instanceName));
          res.json({ status: instance.status, qrCode, qrExpiresAt: new Date(Date.now() + 60_000) });
          return;
        }
      } catch {
        // Evolution API not reachable
      }
    }

    res.json({
      status: instance.status,
      qrCode: instance.qrCode,
      qrExpiresAt: instance.qrExpiresAt,
    });
  },
);

/**
 * DELETE /api/tenants/:tenantId/whatsapp/disconnect
 * Logs out and disconnects the WhatsApp session.
 */
router.delete(
  "/tenants/:tenantId/whatsapp/disconnect",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const [instance] = await db
      .select()
      .from(whatsappInstancesTable)
      .where(eq(whatsappInstancesTable.tenantId, tenantId))
      .limit(1);

    if (!instance) {
      res.status(404).json({ error: "No WhatsApp instance found" });
      return;
    }

    if (isEvolutionConfigured()) {
      try {
        await logoutInstance(instance.instanceName);
      } catch {
        // Continue even if Evolution API fails
      }
    }

    await db
      .update(whatsappInstancesTable)
      .set({
        status: "disconnected",
        qrCode: null,
        phoneNumber: null,
        updatedAt: new Date(),
      })
      .where(eq(whatsappInstancesTable.id, instance.id));

    emitToTenant(tenantId, "whatsapp_status_changed", {
      tenantId,
      status: "disconnected",
    });

    res.status(204).end();
  },
);

export default router;
