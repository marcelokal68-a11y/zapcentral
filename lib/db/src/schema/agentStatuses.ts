import {
  pgTable,
  integer,
  text,
  timestamp,
  pgEnum,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const agentStatusEnum = pgEnum("agent_status_type", [
  "available",
  "busy",
  "away",
  "offline",
]);

export const agentStatusesTable = pgTable(
  "agent_statuses",
  {
    clerkUserId: text("clerk_user_id").notNull(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    status: agentStatusEnum("status").notNull().default("offline"),
    maxConversations: integer("max_conversations").notNull().default(5),
    activeConversations: integer("active_conversations").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.clerkUserId, t.tenantId] }),
    index("agent_statuses_tenant_idx").on(t.tenantId),
    index("agent_statuses_status_idx").on(t.tenantId, t.status),
  ],
);

export const insertAgentStatusSchema = createInsertSchema(
  agentStatusesTable,
).omit({ updatedAt: true });

export const selectAgentStatusSchema = createSelectSchema(agentStatusesTable);

export type AgentStatus = typeof agentStatusesTable.$inferSelect;
export type InsertAgentStatus = z.infer<typeof insertAgentStatusSchema>;
