/**
 * Evolution API webhook receiver.
 * Public endpoint — authenticated by X-Webhook-Secret per instance.
 *
 * POST /api/webhooks/evolution/:instanceName
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  whatsappInstancesTable,
  contactsTable,
  conversationsTable,
  messagesTable,
  channelSettingsTable,
  agentStatusesTable,
  tenantsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { jidToPhone } from "../services/evolution";
import { extractQrMarker, matchesQrMarker } from "../lib/qrMarker";
import {
  processIvrMessage,
  sendTenantMessage,
  tryAutoAssign,
  buildMenuText,
} from "../services/ivr";
import { emitToTenant, emitToAgent } from "../services/socket";

const router = Router();

// ---------------------------------------------------------------------------
// Types for Evolution API webhook payload
// ---------------------------------------------------------------------------
interface EvolutionWebhookPayload {
  event: string;
  instance: string;
  data: Record<string, unknown>;
}

interface MessageData {
  key: { remoteJid: string; id: string; fromMe: boolean };
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messageTimestamp?: number;
}

interface MessageUpdateItem {
  key: { id: string; fromMe: boolean };
  update: { status?: number };
}

// ---------------------------------------------------------------------------
// Status code → our enum
// ---------------------------------------------------------------------------
const statusCodeMap: Record<number, "pending" | "sent" | "delivered" | "read"> =
  {
    1: "pending",
    2: "sent",
    3: "delivered",
    4: "read",
  };

// ---------------------------------------------------------------------------
// Extract text/media info from an Evolution message object
// ---------------------------------------------------------------------------
function extractMessageContent(msg: Record<string, unknown>): {
  type: "text" | "image" | "audio" | "video" | "document" | "location" | "sticker";
  content: string | null;
  mediaUrl: string | null;
  mediaCaption: string | null;
  mediaMimeType: string | null;
  latitude: string | null;
  longitude: string | null;
} {
  if (msg["conversation"]) {
    return {
      type: "text",
      content: String(msg["conversation"]),
      mediaUrl: null,
      mediaCaption: null,
      mediaMimeType: null,
      latitude: null,
      longitude: null,
    };
  }
  if (msg["extendedTextMessage"]) {
    const ext = msg["extendedTextMessage"] as Record<string, unknown>;
    return {
      type: "text",
      content: String(ext["text"] ?? ""),
      mediaUrl: null,
      mediaCaption: null,
      mediaMimeType: null,
      latitude: null,
      longitude: null,
    };
  }
  if (msg["imageMessage"]) {
    const im = msg["imageMessage"] as Record<string, unknown>;
    return {
      type: "image",
      content: null,
      mediaUrl: String(im["url"] ?? ""),
      mediaCaption: im["caption"] ? String(im["caption"]) : null,
      mediaMimeType: im["mimetype"] ? String(im["mimetype"]) : null,
      latitude: null,
      longitude: null,
    };
  }
  if (msg["audioMessage"]) {
    const am = msg["audioMessage"] as Record<string, unknown>;
    return {
      type: "audio",
      content: null,
      mediaUrl: String(am["url"] ?? ""),
      mediaCaption: null,
      mediaMimeType: am["mimetype"] ? String(am["mimetype"]) : null,
      latitude: null,
      longitude: null,
    };
  }
  if (msg["videoMessage"]) {
    const vm = msg["videoMessage"] as Record<string, unknown>;
    return {
      type: "video",
      content: null,
      mediaUrl: String(vm["url"] ?? ""),
      mediaCaption: vm["caption"] ? String(vm["caption"]) : null,
      mediaMimeType: vm["mimetype"] ? String(vm["mimetype"]) : null,
      latitude: null,
      longitude: null,
    };
  }
  if (msg["documentMessage"]) {
    const dm = msg["documentMessage"] as Record<string, unknown>;
    return {
      type: "document",
      content: dm["title"] ? String(dm["title"]) : null,
      mediaUrl: String(dm["url"] ?? ""),
      mediaCaption: null,
      mediaMimeType: dm["mimetype"] ? String(dm["mimetype"]) : null,
      latitude: null,
      longitude: null,
    };
  }
  if (msg["locationMessage"]) {
    const lm = msg["locationMessage"] as Record<string, unknown>;
    return {
      type: "location",
      content: lm["name"] ? String(lm["name"]) : null,
      mediaUrl: null,
      mediaCaption: null,
      mediaMimeType: null,
      latitude: String(lm["degreesLatitude"] ?? ""),
      longitude: String(lm["degreesLongitude"] ?? ""),
    };
  }
  if (msg["stickerMessage"]) {
    const sm = msg["stickerMessage"] as Record<string, unknown>;
    return {
      type: "sticker",
      content: null,
      mediaUrl: String(sm["url"] ?? ""),
      mediaCaption: null,
      mediaMimeType: sm["mimetype"] ? String(sm["mimetype"]) : null,
      latitude: null,
      longitude: null,
    };
  }
  return {
    type: "text",
    content: null,
    mediaUrl: null,
    mediaCaption: null,
    mediaMimeType: null,
    latitude: null,
    longitude: null,
  };
}

// ---------------------------------------------------------------------------
// Main webhook handler
// ---------------------------------------------------------------------------
router.post(
  "/webhooks/evolution/:instanceName",
  async (req, res): Promise<void> => {
    const instanceName = String(req.params["instanceName"]);
    const payload = req.body as EvolutionWebhookPayload;

    // Look up the instance
    const [instance] = await db
      .select()
      .from(whatsappInstancesTable)
      .where(eq(whatsappInstancesTable.instanceName, instanceName))
      .limit(1);

    if (!instance) {
      res.status(404).json({ error: "Instance not found" });
      return;
    }

    // Validate webhook secret if configured
    if (instance.webhookSecret) {
      const provided = req.headers["x-webhook-secret"];
      if (provided !== instance.webhookSecret) {
        res.status(401).json({ error: "Invalid webhook secret" });
        return;
      }
    }

    const tenantId = instance.tenantId;
    const event = payload.event ?? "";
    const data = payload.data ?? {};

    try {
      if (event === "qrcode.updated") {
        const qr = data["qrcode"] as Record<string, unknown> | undefined;
        await db
          .update(whatsappInstancesTable)
          .set({
            qrCode: String(qr?.["base64"] ?? qr?.["code"] ?? ""),
            qrExpiresAt: new Date(Date.now() + 60_000),
            status: "connecting",
            updatedAt: new Date(),
          })
          .where(eq(whatsappInstancesTable.id, instance.id));

        emitToTenant(tenantId, "whatsapp_qr_updated", {
          tenantId,
          qrCode: qr?.["base64"] ?? qr?.["code"],
        });
      } else if (event === "connection.update") {
        const state = String(data["state"] ?? "");
        const mapped =
          state === "open"
            ? "connected"
            : state === "connecting"
              ? "connecting"
              : "disconnected";
        await db
          .update(whatsappInstancesTable)
          .set({
            status: mapped,
            lastConnectedAt: state === "open" ? new Date() : undefined,
            qrCode: state === "open" ? null : undefined,
            updatedAt: new Date(),
          })
          .where(eq(whatsappInstancesTable.id, instance.id));

        emitToTenant(tenantId, "whatsapp_status_changed", {
          tenantId,
          status: mapped,
        });
      } else if (event === "messages.upsert") {
        const msgData = data as unknown as MessageData;
        const key = msgData.key;
        if (!key || key.fromMe) {
          // Skip outbound messages echoed back
          res.status(200).json({ ok: true });
          return;
        }

        const phone = jidToPhone(key.remoteJid);
        const msgContent = extractMessageContent(
          msgData.message ?? {},
        );
        const msgId = key.id;
        const msgTimestamp = msgData.messageTimestamp
          ? new Date(msgData.messageTimestamp * 1000)
          : new Date();

        // Idempotency check
        const [existing] = await db
          .select({ id: messagesTable.id })
          .from(messagesTable)
          .where(
            and(
              eq(messagesTable.tenantId, tenantId),
              eq(messagesTable.messageId, msgId),
            ),
          )
          .limit(1);

        if (existing) {
          res.status(200).json({ ok: true });
          return;
        }

        // Upsert contact
        const [contact] = await db
          .insert(contactsTable)
          .values({
            tenantId,
            phone,
            name: msgData.pushName ?? null,
            lastContactAt: msgTimestamp,
          })
          .onConflictDoUpdate({
            target: [contactsTable.tenantId, contactsTable.phone],
            set: {
              name: msgData.pushName ?? undefined,
              lastContactAt: msgTimestamp,
              updatedAt: new Date(),
            },
          })
          .returning();

        if (!contact) throw new Error("Failed to upsert contact");

        // QR attribution: the public QR page appends a "QR-xxxxxx" marker
        // (first 6 hex chars of the tenant's share token) to the pre-filled
        // message. If present and matching, tag the contact's origin as 'qr'.
        // Precedence: a valid QR marker overrides 'organic' AND 'invite'
        // (scanning the QR is a definitive channel event; pre-registration
        // provenance remains visible via the contact's name/CPF). Once 'qr',
        // it stays 'qr'.
        if (
          contact.origin !== "qr" &&
          msgContent.type === "text" &&
          msgContent.content
        ) {
          const marker = extractQrMarker(msgContent.content);
          if (marker) {
            const [tenant] = await db
              .select({ qrShareToken: tenantsTable.qrShareToken })
              .from(tenantsTable)
              .where(eq(tenantsTable.id, tenantId))
              .limit(1);
            if (matchesQrMarker(msgContent.content, tenant?.qrShareToken)) {
              await db
                .update(contactsTable)
                .set({ origin: "qr", updatedAt: new Date() })
                .where(eq(contactsTable.id, contact.id));
            }
          }
        }

        // Find or create open conversation for this contact
        let [conversation] = await db
          .select()
          .from(conversationsTable)
          .where(
            and(
              eq(conversationsTable.tenantId, tenantId),
              eq(conversationsTable.contactId, contact.id),
              sql`${conversationsTable.status} NOT IN ('closed')`,
            ),
          )
          .limit(1);

        if (!conversation) {
          const [newConv] = await db
            .insert(conversationsTable)
            .values({
              tenantId,
              contactId: contact.id,
              status: "new",
              lastMessageAt: msgTimestamp,
            })
            .returning();
          conversation = newConv!;
        }

        // Save the inbound message
        const [savedMsg] = await db
          .insert(messagesTable)
          .values({
            conversationId: conversation.id,
            tenantId,
            messageId: msgId,
            fromPhone: phone,
            toPhone: instance.phoneNumber ?? "",
            type: msgContent.type,
            content: msgContent.content,
            mediaUrl: msgContent.mediaUrl,
            mediaCaption: msgContent.mediaCaption,
            mediaMimeType: msgContent.mediaMimeType,
            latitude: msgContent.latitude,
            longitude: msgContent.longitude,
            direction: "inbound",
            status: "received",
            timestamp: msgTimestamp,
          })
          .returning();

        // Emit new message to tenant room
        emitToTenant(tenantId, "new_message", {
          message: savedMsg,
          conversationId: conversation.id,
          contact,
        });

        // If conversation has an assigned agent, notify them too
        if (conversation.assignedTo) {
          emitToAgent(conversation.assignedTo, "new_message", {
            message: savedMsg,
            conversationId: conversation.id,
          });
        }

        // Update conversation last message time
        await db
          .update(conversationsTable)
          .set({ lastMessageAt: msgTimestamp, updatedAt: new Date() })
          .where(eq(conversationsTable.id, conversation.id));

        // Process IVR if in new/ivr state and message is text
        if (
          ["new", "ivr"].includes(conversation.status) &&
          msgContent.type === "text" &&
          msgContent.content
        ) {
          const result = await processIvrMessage(
            conversation.id,
            tenantId,
            msgContent.content,
          );

          switch (result.action) {
            case "send_menu": {
              // Send IVR menu
              await sendTenantMessage(
                tenantId,
                conversation.id,
                phone,
                result.replyText ?? "",
                instance.phoneNumber ?? "",
              );
              await db
                .update(conversationsTable)
                .set({
                  status: "ivr",
                  ivrStep: "menu_sent",
                  ivrAttempts: 0,
                  updatedAt: new Date(),
                })
                .where(eq(conversationsTable.id, conversation.id));
              break;
            }
            case "off_hours": {
              await sendTenantMessage(
                tenantId,
                conversation.id,
                phone,
                result.replyText ?? "",
                instance.phoneNumber ?? "",
              );
              await db
                .update(conversationsTable)
                .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
                .where(eq(conversationsTable.id, conversation.id));
              break;
            }
            case "route_to_department":
            case "max_attempts": {
              if (result.replyText) {
                await sendTenantMessage(
                  tenantId,
                  conversation.id,
                  phone,
                  result.replyText,
                  instance.phoneNumber ?? "",
                );
              }

              // Get settings for distribution mode
              const [settings] = await db
                .select({ distributionMode: channelSettingsTable.distributionMode })
                .from(channelSettingsTable)
                .where(eq(channelSettingsTable.tenantId, tenantId))
                .limit(1);

              const mode = settings?.distributionMode ?? "manual";
              const deptId = result.departmentId;

              // Transition to 'waiting' FIRST — tryAutoAssign requires the conversation
              // to be in the 'waiting' state (with assignedTo=null) before it can claim it.
              await db
                .update(conversationsTable)
                .set({
                  departmentId: deptId ?? null,
                  status: "waiting",
                  assignedTo: null,
                  ivrStep: null,
                  updatedAt: new Date(),
                })
                .where(eq(conversationsTable.id, conversation.id));

              // Now try to auto-assign (conversation is waiting+unassigned, so tryAutoAssign
              // will find it and atomically transition it to 'active' if an agent is available)
              const assignedAgent = deptId
                ? await tryAutoAssign(tenantId, conversation.id, deptId, mode)
                : null;

              const updatedConv = await db
                .select()
                .from(conversationsTable)
                .where(eq(conversationsTable.id, conversation.id))
                .then((r) => r[0]);

              emitToTenant(tenantId, "conversation_updated", {
                conversation: updatedConv,
              });
              if (assignedAgent) {
                emitToAgent(assignedAgent, "conversation_assigned", {
                  conversation: updatedConv,
                });
              }
              break;
            }
            case "invalid_option": {
              await sendTenantMessage(
                tenantId,
                conversation.id,
                phone,
                result.replyText ?? "",
                instance.phoneNumber ?? "",
              );
              await db
                .update(conversationsTable)
                .set({
                  ivrAttempts: sql`${conversationsTable.ivrAttempts} + 1`,
                  updatedAt: new Date(),
                })
                .where(eq(conversationsTable.id, conversation.id));
              break;
            }
          }
        }
      } else if (event === "messages.update") {
        const updates = data as unknown as MessageUpdateItem[];
        for (const update of Array.isArray(updates) ? updates : []) {
          const statusCode = update.update?.status;
          const mapped = statusCode ? statusCodeMap[statusCode] : undefined;
          if (mapped && update.key.id) {
            await db
              .update(messagesTable)
              .set({ status: mapped })
              .where(
                and(
                  eq(messagesTable.tenantId, tenantId),
                  eq(messagesTable.messageId, update.key.id),
                ),
              );
          }
        }
      }
    } catch (err) {
      req.log.error({ err }, "Webhook processing error");
    }

    res.status(200).json({ ok: true });
  },
);

export default router;
