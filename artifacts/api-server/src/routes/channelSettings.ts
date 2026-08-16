/**
 * Channel settings and quick replies routes.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  channelSettingsTable,
  quickRepliesTable,
  insertChannelSettingsSchema,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";

const router = Router();

const channelSettingsPatchSchema = z.object({
  welcomeMessage: z.string().min(1).max(500).optional(),
  menuPrompt: z.string().min(1).max(200).optional(),
  menuOptions: z
    .array(
      z.object({
        key: z.string().min(1).max(5),
        label: z.string().min(1).max(100),
        departmentId: z.number().int(),
      }),
    )
    .max(9)
    .optional(),
  offHoursMessage: z.string().min(1).max(500).optional(),
  closingMessage: z.string().min(1).max(500).optional(),
  inactivityTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
  autoCloseEnabled: z.boolean().optional(),
  distributionMode: z.enum(["manual", "round_robin", "least_load"]).optional(),
  workingHoursEnabled: z.boolean().optional(),
  workingHours: z
    .record(
      z.object({
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
        active: z.boolean(),
      }),
    )
    .optional(),
});

const quickReplySchema = z.object({
  shortcut: z
    .string()
    .min(1)
    .max(50)
    .regex(/^\/[\w-]+$/, "Shortcut must start with / and contain only word chars"),
  content: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// GET /api/tenants/:tenantId/channel-settings
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/channel-settings",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    let [settings] = await db
      .select()
      .from(channelSettingsTable)
      .where(eq(channelSettingsTable.tenantId, tenantId))
      .limit(1);

    // Auto-create default settings if missing
    if (!settings) {
      const [created] = await db
        .insert(channelSettingsTable)
        .values({ tenantId })
        .returning();
      settings = created!;
    }

    res.json(settings);
  },
);

// ---------------------------------------------------------------------------
// PUT /api/tenants/:tenantId/channel-settings
// ---------------------------------------------------------------------------
router.put(
  "/tenants/:tenantId/channel-settings",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const parsed = channelSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const data = parsed.data;
    if (data.welcomeMessage !== undefined) updates["welcomeMessage"] = data.welcomeMessage;
    if (data.menuPrompt !== undefined) updates["menuPrompt"] = data.menuPrompt;
    if (data.menuOptions !== undefined) updates["menuOptions"] = data.menuOptions;
    if (data.offHoursMessage !== undefined) updates["offHoursMessage"] = data.offHoursMessage;
    if (data.closingMessage !== undefined) updates["closingMessage"] = data.closingMessage;
    if (data.inactivityTimeoutMinutes !== undefined)
      updates["inactivityTimeoutMinutes"] = data.inactivityTimeoutMinutes;
    if (data.autoCloseEnabled !== undefined) updates["autoCloseEnabled"] = data.autoCloseEnabled;
    if (data.distributionMode !== undefined) updates["distributionMode"] = data.distributionMode;
    if (data.workingHoursEnabled !== undefined)
      updates["workingHoursEnabled"] = data.workingHoursEnabled;
    if (data.workingHours !== undefined) updates["workingHours"] = data.workingHours;

    // Upsert
    const [existing] = await db
      .select({ id: channelSettingsTable.id })
      .from(channelSettingsTable)
      .where(eq(channelSettingsTable.tenantId, tenantId))
      .limit(1);

    let result;
    if (existing) {
      const [updated] = await db
        .update(channelSettingsTable)
        .set(updates)
        .where(eq(channelSettingsTable.id, existing.id))
        .returning();
      result = updated;
    } else {
      const [created] = await db
        .insert(channelSettingsTable)
        .values({ tenantId, ...updates })
        .returning();
      result = created;
    }

    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// Quick replies
// ---------------------------------------------------------------------------

router.get(
  "/tenants/:tenantId/quick-replies",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const replies = await db
      .select()
      .from(quickRepliesTable)
      .where(eq(quickRepliesTable.tenantId, tenantId));
    res.json(replies);
  },
);

router.post(
  "/tenants/:tenantId/quick-replies",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);

    const parsed = quickReplySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }

    const [reply] = await db
      .insert(quickRepliesTable)
      .values({ tenantId, ...parsed.data })
      .returning();

    res.status(201).json(reply);
  },
);

router.delete(
  "/tenants/:tenantId/quick-replies/:replyId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const replyId = Number(req.params["replyId"]);

    await db
      .delete(quickRepliesTable)
      .where(
        and(
          eq(quickRepliesTable.id, replyId),
          eq(quickRepliesTable.tenantId, tenantId),
        ),
      );

    res.status(204).end();
  },
);

export default router;
