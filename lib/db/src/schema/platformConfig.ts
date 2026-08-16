/**
 * platform_config — single-row key/value store for one-time platform events.
 * Used to make the super-admin bootstrap claim atomic at the DB layer.
 */
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const platformConfigTable = pgTable(
  "platform_config",
  {
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("platform_config_key_idx").on(t.key)],
);

export type PlatformConfig = typeof platformConfigTable.$inferSelect;
