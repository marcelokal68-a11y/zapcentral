import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { contactsTable } from "./contacts";

export const customFieldTypeEnum = pgEnum("custom_field_type", [
  "text",
  "number",
  "date",
  "select",
]);

export const customFieldsTable = pgTable(
  "custom_fields",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: customFieldTypeEnum("type").notNull().default("text"),
    /** Options for `select` type fields */
    options: jsonb("options").$type<string[]>(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("custom_fields_tenant_name_idx").on(t.tenantId, t.name),
    index("custom_fields_tenant_idx").on(t.tenantId),
  ],
);

export const customFieldValuesTable = pgTable(
  "custom_field_values",
  {
    contactId: integer("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
    fieldId: integer("field_id")
      .notNull()
      .references(() => customFieldsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.fieldId] }),
    index("custom_field_values_field_idx").on(t.fieldId),
    index("custom_field_values_tenant_idx").on(t.tenantId),
  ],
);

export const insertCustomFieldSchema = createInsertSchema(
  customFieldsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const selectCustomFieldSchema = createSelectSchema(customFieldsTable);

export type CustomField = typeof customFieldsTable.$inferSelect;
export type InsertCustomField = z.infer<typeof insertCustomFieldSchema>;
export type CustomFieldValue = typeof customFieldValuesTable.$inferSelect;
