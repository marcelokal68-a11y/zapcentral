import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  index,
  numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { contactsTable } from "./contacts";

export const dealStatusEnum = pgEnum("deal_status", ["open", "won", "lost"]);

export const dealStagesTable = pgTable(
  "deal_stages",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#25D366"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("deal_stages_tenant_idx").on(t.tenantId)],
);

export const dealsTable = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    contactId: integer("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
    stageId: integer("stage_id")
      .notNull()
      .references(() => dealStagesTable.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    /** Deal value in BRL, stored as numeric string */
    value: numeric("value", { precision: 14, scale: 2 }),
    status: dealStatusEnum("status").notNull().default("open"),
    /** Clerk user id of the responsible agent */
    assignedTo: text("assigned_to"),
    description: text("description"),
    expectedCloseAt: timestamp("expected_close_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("deals_tenant_idx").on(t.tenantId),
    index("deals_contact_idx").on(t.contactId),
    index("deals_stage_idx").on(t.stageId),
    index("deals_assigned_idx").on(t.assignedTo),
  ],
);

export const insertDealStageSchema = createInsertSchema(dealStagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDealSchema = createInsertSchema(dealsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const selectDealStageSchema = createSelectSchema(dealStagesTable);
export const selectDealSchema = createSelectSchema(dealsTable);

export type DealStage = typeof dealStagesTable.$inferSelect;
export type InsertDealStage = z.infer<typeof insertDealStageSchema>;
export type Deal = typeof dealsTable.$inferSelect;
export type InsertDeal = z.infer<typeof insertDealSchema>;
