import {
  pgTable,
  text,
  integer,
  timestamp,
  pgEnum,
  boolean,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "supervisor",
  "agent",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "suspended",
]);

export const tenantUsersTable = pgTable(
  "tenant_users",
  {
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    avatarUrl: text("avatar_url"),
    role: userRoleEnum("role").notNull().default("agent"),
    status: userStatusEnum("status").notNull().default("invited"),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.clerkUserId] }),
    index("tenant_users_clerk_idx").on(t.clerkUserId),
    index("tenant_users_tenant_idx").on(t.tenantId),
  ],
);

export const insertTenantUserSchema = createInsertSchema(
  tenantUsersTable,
).omit({ joinedAt: true, updatedAt: true });

export const selectTenantUserSchema = createSelectSchema(tenantUsersTable);

export type InsertTenantUser = z.infer<typeof insertTenantUserSchema>;
export type TenantUser = typeof tenantUsersTable.$inferSelect;
