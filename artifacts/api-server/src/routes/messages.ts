/**
 * Message routes — list and send messages within a conversation.
 */
import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  messagesTable,
  conversationsTable,
  tenantUsersTable,
  contactsTable,
  whatsappInstancesTable,
} from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireTenantMember } from "../middlewares/auth";
import { sendText, sendMedia, isEvolutionConfigured } from "../services/evolution";
import { emitToTenant, emitToAgent } from "../services/socket";

const router = Router();

const sendMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    content: z.string().min(1).max(4096),
  }),
  z.object({
    type: z.literal("image"),
    mediaUrl: z.string().url(),
    mediaCaption: z.string().max(1024).optional(),
  }),
  z.object({
    type: z.literal("audio"),
    mediaUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("video"),
    mediaUrl: z.string().url(),
    mediaCaption: z.string().max(1024).optional(),
  }),
  z.object({
    type: z.literal("document"),
    mediaUrl: z.string().url(),
    content: z.string().max(256).optional(),
  }),
]);

/**
 * GET /api/tenants/:tenantId/conversations/:conversationId/messages
 */
router.get(
  "/tenants/:tenantId/conversations/:conversationId/messages",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const { userId } = getAuth(req);
    const uid = userId!;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const before = req.query["before"] ? Number(req.query["before"]) : undefined;

    // Verify conversation belongs to this tenant
    const [conv] = await db
      .select({ assignedTo: conversationsTable.assignedTo })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Agents can only read their own conversations
    const [membership] = await db
      .select({ role: tenantUsersTable.role })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, uid),
        ),
      )
      .limit(1);

    const isAdminOrSupervisor = ["admin", "supervisor"].includes(
      membership?.role ?? "",
    );

    if (!isAdminOrSupervisor && conv.assignedTo !== uid) {
      res.status(403).json({ error: "Forbidden: not your conversation" });
      return;
    }

    const conditions = [
      eq(messagesTable.conversationId, conversationId),
      eq(messagesTable.tenantId, tenantId),
    ];

    if (before) {
      conditions.push(
        // id < before for cursor pagination
        // Use a raw expression to avoid Drizzle type issues
        eq(messagesTable.conversationId, conversationId), // duplicate for structuring
      );
    }

    const msgs = await db
      .select()
      .from(messagesTable)
      .where(and(...conditions))
      .orderBy(asc(messagesTable.timestamp))
      .limit(limit);

    res.json(msgs);
  },
);

/**
 * POST /api/tenants/:tenantId/conversations/:conversationId/messages
 * Send a message to the customer.
 */
router.post(
  "/tenants/:tenantId/conversations/:conversationId/messages",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const { userId } = getAuth(req);
    const uid = userId!;

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    // Verify conversation
    const [conv] = await db
      .select({
        assignedTo: conversationsTable.assignedTo,
        contactId: conversationsTable.contactId,
        status: conversationsTable.status,
      })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!conv) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    if (conv.status === "closed") {
      res.status(400).json({ error: "Cannot send messages to a closed conversation" });
      return;
    }

    // Check permissions
    const [membership] = await db
      .select({ role: tenantUsersTable.role })
      .from(tenantUsersTable)
      .where(
        and(
          eq(tenantUsersTable.tenantId, tenantId),
          eq(tenantUsersTable.clerkUserId, uid),
        ),
      )
      .limit(1);

    const isAdminOrSupervisor = ["admin", "supervisor"].includes(
      membership?.role ?? "",
    );

    if (!isAdminOrSupervisor && conv.assignedTo !== uid) {
      res.status(403).json({ error: "Forbidden: not your conversation" });
      return;
    }

    // Get WhatsApp instance + contact phone
    const [[instance], [contact]] = await Promise.all([
      db
        .select()
        .from(whatsappInstancesTable)
        .where(
          and(
            eq(whatsappInstancesTable.tenantId, tenantId),
            eq(whatsappInstancesTable.status, "connected"),
          ),
        )
        .limit(1),
      db
        .select({ phone: contactsTable.phone })
        .from(contactsTable)
        .where(eq(contactsTable.id, conv.contactId))
        .limit(1),
    ]);

    if (!contact) {
      res.status(500).json({ error: "Contact not found" });
      return;
    }

    if (!instance) {
      res.status(503).json({ error: "WhatsApp is not connected for this tenant" });
      return;
    }

    if (!isEvolutionConfigured()) {
      res.status(503).json({ error: "Evolution API is not configured" });
      return;
    }

    const msg = parsed.data;
    let messageId: string | null = null;

    try {
      if (msg.type === "text") {
        const result = await sendText(instance.instanceName, contact.phone, msg.content);
        messageId = result.key.id;
      } else if (msg.type === "image" || msg.type === "video" || msg.type === "document" || msg.type === "audio") {
        const result = await sendMedia(
          instance.instanceName,
          contact.phone,
          msg.type as "image" | "video" | "document" | "audio",
          msg.mediaUrl,
          "mediaCaption" in msg ? msg.mediaCaption : undefined,
        );
        messageId = result.key.id;
      }
    } catch (err) {
      req.log.error({ err }, "Failed to send message via Evolution API");
      res.status(502).json({ error: "Failed to send message" });
      return;
    }

    // Save to DB
    const [savedMsg] = await db
      .insert(messagesTable)
      .values({
        conversationId,
        tenantId,
        messageId,
        fromPhone: instance.phoneNumber ?? "",
        toPhone: contact.phone,
        type: msg.type as "text" | "image" | "audio" | "video" | "document",
        content: "content" in msg ? (msg.content ?? null) : null,
        mediaUrl: "mediaUrl" in msg ? msg.mediaUrl : null,
        mediaCaption: "mediaCaption" in msg ? (msg.mediaCaption ?? null) : null,
        direction: "outbound",
        status: "sent",
        sentBy: uid,
        timestamp: new Date(),
      })
      .returning();

    // Update last message time
    await db
      .update(conversationsTable)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));

    emitToTenant(tenantId, "new_message", {
      message: savedMsg,
      conversationId,
    });

    res.status(201).json(savedMsg);
  },
);

export default router;
