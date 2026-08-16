import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { conversationsTable } from "./conversations";

export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "image",
  "audio",
  "video",
  "document",
  "location",
  "sticker",
  "template",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "received",   // inbound received
  "pending",    // outbound queued
  "sent",       // sent to Evolution API
  "delivered",  // delivered to device
  "read",       // read by recipient
  "failed",     // send failed
]);

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    /** Evolution API message ID — used for idempotency and status updates */
    messageId: text("message_id"),
    fromPhone: text("from_phone").notNull(),
    toPhone: text("to_phone").notNull(),
    type: messageTypeEnum("type").notNull().default("text"),
    content: text("content"),
    mediaUrl: text("media_url"),
    mediaCaption: text("media_caption"),
    mediaMimeType: text("media_mime_type"),
    /** latitude for location messages */
    latitude: text("latitude"),
    /** longitude for location messages */
    longitude: text("longitude"),
    direction: messageDirectionEnum("direction").notNull(),
    status: messageStatusEnum("status").notNull().default("received"),
    /** clerkUserId for outbound messages sent by agents */
    sentBy: text("sent_by"),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_tenant_msgid_idx").on(t.tenantId, t.messageId),
    index("messages_conversation_idx").on(t.conversationId),
    index("messages_tenant_idx").on(t.tenantId),
    index("messages_timestamp_idx").on(t.timestamp),
  ],
);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  createdAt: true,
});

export const selectMessageSchema = createSelectSchema(messagesTable);

export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
