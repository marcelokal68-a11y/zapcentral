import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantStatusEnum = pgEnum("tenant_status", [
  "active",
  "suspended",
  "pending",
]);

export const tenantPlanEnum = pgEnum("tenant_plan", [
  "trial",
  "starter",
  "professional",
  "enterprise",
]);

export const tenantsTable = pgTable(
  "tenants",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logoUrl: text("logo_url"),
    planType: tenantPlanEnum("plan_type").notNull().default("trial"),
    status: tenantStatusEnum("status").notNull().default("pending"),
    maxAgents: integer("max_agents").notNull().default(5),
    /** Unguessable token for the public QR share page (null = sharing disabled) */
    qrShareToken: text("qr_share_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tenants_slug_idx").on(t.slug),
    uniqueIndex("tenants_qr_share_token_idx")
      .on(t.qrShareToken)
      .where(sql`${t.qrShareToken} IS NOT NULL`),
  ],
);

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectTenantSchema = createSelectSchema(tenantsTable);

export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
