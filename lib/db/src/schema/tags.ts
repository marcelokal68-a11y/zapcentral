import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { contactsTable } from "./contacts";
import { conversationsTable } from "./conversations";

export const tagsTable = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#25D366"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tags_tenant_name_idx").on(t.tenantId, t.name),
    index("tags_tenant_idx").on(t.tenantId),
  ],
);

export const contactTagsTable = pgTable(
  "contact_tags",
  {
    contactId: integer("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.tagId] }),
    index("contact_tags_tag_idx").on(t.tagId),
    index("contact_tags_tenant_idx").on(t.tenantId),
  ],
);

export const conversationTagsTable = pgTable(
  "conversation_tags",
  {
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.tagId] }),
    index("conversation_tags_tag_idx").on(t.tagId),
    index("conversation_tags_tenant_idx").on(t.tenantId),
  ],
);

export const insertTagSchema = createInsertSchema(tagsTable).omit({
  id: true,
  createdAt: true,
});

export const selectTagSchema = createSelectSchema(tagsTable);

export type Tag = typeof tagsTable.$inferSelect;
export type InsertTag = z.infer<typeof insertTagSchema>;
export type ContactTag = typeof contactTagsTable.$inferSelect;
export type ConversationTag = typeof conversationTagsTable.$inferSelect;
