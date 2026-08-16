import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";
import { tenantsTable } from "./tenants";

export const departmentAgentsTable = pgTable(
  "department_agents",
  {
    departmentId: integer("department_id")
      .notNull()
      .references(() => departmentsTable.id, { onDelete: "cascade" }),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.departmentId, t.clerkUserId] }),
    index("dept_agents_tenant_idx").on(t.tenantId),
    index("dept_agents_dept_idx").on(t.departmentId),
    index("dept_agents_user_idx").on(t.clerkUserId),
  ],
);

export const insertDepartmentAgentSchema = createInsertSchema(
  departmentAgentsTable,
).omit({ addedAt: true });

export const selectDepartmentAgentSchema = createSelectSchema(
  departmentAgentsTable,
);

export type InsertDepartmentAgent = z.infer<typeof insertDepartmentAgentSchema>;
export type DepartmentAgent = typeof departmentAgentsTable.$inferSelect;
