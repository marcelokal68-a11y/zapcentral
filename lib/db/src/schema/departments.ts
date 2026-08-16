import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const departmentStatusEnum = pgEnum("department_status", [
  "active",
  "inactive",
]);

export const departmentsTable = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#25D366"),
    status: departmentStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("departments_tenant_idx").on(t.tenantId)],
);

export const insertDepartmentSchema = createInsertSchema(departmentsTable).omit(
  { id: true, createdAt: true, updatedAt: true },
);

export const selectDepartmentSchema = createSelectSchema(departmentsTable);

export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departmentsTable.$inferSelect;
