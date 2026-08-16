import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const distributionModeEnum = pgEnum("distribution_mode", [
  "manual",
  "round_robin",
  "least_load",
]);

export type IvrMenuOption = {
  key: string;
  label: string;
  departmentId: number;
};

export type WorkingHoursDay = {
  start: string; // "HH:MM"
  end: string;
  active: boolean;
};

export type WorkingHours = {
  monday: WorkingHoursDay;
  tuesday: WorkingHoursDay;
  wednesday: WorkingHoursDay;
  thursday: WorkingHoursDay;
  friday: WorkingHoursDay;
  saturday: WorkingHoursDay;
  sunday: WorkingHoursDay;
};

export const channelSettingsTable = pgTable(
  "channel_settings",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    welcomeMessage: text("welcome_message")
      .notNull()
      .default("Olá! Bem-vindo ao nosso atendimento. 👋"),
    menuPrompt: text("menu_prompt")
      .notNull()
      .default("Por favor, escolha uma opção:"),
    menuOptions: jsonb("menu_options")
      .notNull()
      .$type<IvrMenuOption[]>()
      .default([]),
    offHoursMessage: text("off_hours_message")
      .notNull()
      .default(
        "Nosso atendimento está fechado no momento. Retornaremos em breve!",
      ),
    closingMessage: text("closing_message")
      .notNull()
      .default(
        "Conversa encerrada. Obrigado por entrar em contato! 😊",
      ),
    inactivityTimeoutMinutes: integer("inactivity_timeout_minutes")
      .notNull()
      .default(30),
    autoCloseEnabled: boolean("auto_close_enabled").notNull().default(true),
    distributionMode: distributionModeEnum("distribution_mode")
      .notNull()
      .default("round_robin"),
    workingHoursEnabled: boolean("working_hours_enabled")
      .notNull()
      .default(false),
    workingHours: jsonb("working_hours").$type<WorkingHours>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("channel_settings_tenant_idx").on(t.tenantId)],
);

export const insertChannelSettingsSchema = createInsertSchema(
  channelSettingsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export const selectChannelSettingsSchema = createSelectSchema(
  channelSettingsTable,
);

export type ChannelSettings = typeof channelSettingsTable.$inferSelect;
export type InsertChannelSettings = z.infer<
  typeof insertChannelSettingsSchema
>;
