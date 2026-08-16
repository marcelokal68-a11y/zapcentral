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

export const instanceStatusEnum = pgEnum("whatsapp_instance_status", [
  "connecting",
  "connected",
  "disconnected",
  "error",
]);

export const whatsappInstancesTable = pgTable(
  "whatsapp_instances",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    instanceName: text("instance_name").notNull(),
    apiToken: text("api_token"),
    phoneNumber: text("phone_number"),
    status: instanceStatusEnum("status").notNull().default("disconnected"),
    qrCode: text("qr_code"),
    qrExpiresAt: timestamp("qr_expires_at", { withTimezone: true }),
    lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
    webhookSecret: text("webhook_secret"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_instances_tenant_idx").on(t.tenantId),
    uniqueIndex("whatsapp_instances_name_idx").on(t.instanceName),
    index("whatsapp_instances_status_idx").on(t.status),
  ],
);

export const insertWhatsappInstanceSchema = createInsertSchema(
  whatsappInstancesTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const selectWhatsappInstanceSchema = createSelectSchema(
  whatsappInstancesTable,
);

export type WhatsappInstance = typeof whatsappInstancesTable.$inferSelect;
export type InsertWhatsappInstance = z.infer<
  typeof insertWhatsappInstanceSchema
>;
