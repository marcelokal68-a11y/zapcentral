import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { contactsTable } from "./contacts";
import { conversationsTable } from "./conversations";

/** Internal notes on a contact (optionally linked to a conversation). Team-only. */
export const contactNotesTable = pgTable(
  "contact_notes",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id").references(
      () => conversationsTable.id,
      { onDelete: "set null" },
    ),
    /** Clerk user id of the author */
    authorId: text("author_id").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("contact_notes_contact_idx").on(t.contactId),
    index("contact_notes_conversation_idx").on(t.conversationId),
    index("contact_notes_tenant_idx").on(t.tenantId),
  ],
);

export const insertContactNoteSchema = createInsertSchema(
  contactNotesTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const selectContactNoteSchema = createSelectSchema(contactNotesTable);

export type ContactNote = typeof contactNotesTable.$inferSelect;
export type InsertContactNote = z.infer<typeof insertContactNoteSchema>;
