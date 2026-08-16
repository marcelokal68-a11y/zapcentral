import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const quickRepliesTable = pgTable(
  "quick_replies",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    /** Shortcut the agent types (e.g. "/ola") */
    shortcut: text("shortcut").notNull(),
    /** Full content to be sent */
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("quick_replies_tenant_shortcut_idx").on(t.tenantId, t.shortcut),
    index("quick_replies_tenant_idx").on(t.tenantId),
  ],
);

export const insertQuickReplySchema = createInsertSchema(quickRepliesTable).omit(
  { id: true, createdAt: true, updatedAt: true },
);

export const selectQuickReplySchema = createSelectSchema(quickRepliesTable);

export type QuickReply = typeof quickRepliesTable.$inferSelect;
export type InsertQuickReply = z.infer<typeof insertQuickReplySchema>;
