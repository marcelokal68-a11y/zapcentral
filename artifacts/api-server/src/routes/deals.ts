/**
 * Deal pipeline routes (CRM): stages + deals kanban.
 */
import { Router, type IRouter } from "express";
import { db, dealStagesTable, dealsTable, contactsTable } from "@workspace/db";
import { eq, and, asc, desc, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";

const router: IRouter = Router();

const DEFAULT_STAGES = [
  { name: "Novo Lead", color: "#3b82f6" },
  { name: "Em Contato", color: "#8b5cf6" },
  { name: "Proposta Enviada", color: "#f59e0b" },
  { name: "Negociação", color: "#f97316" },
  { name: "Fechamento", color: "#22c55e" },
];

const stageInputSchema = z.object({
  name: z.string().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  position: z.number().int().min(0).optional(),
});

const dealInputSchema = z.object({
  contactId: z.number().int(),
  stageId: z.number().int(),
  title: z.string().min(1).max(120),
  value: z.number().min(0).max(999999999999).nullable().optional(),
  assignedTo: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  expectedCloseAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const dealPatchSchema = dealInputSchema.partial().extend({
  status: z.enum(["open", "won", "lost"]).optional(),
});

// ---------------------------------------------------------------------------
// Deal stages
// ---------------------------------------------------------------------------

router.get(
  "/tenants/:tenantId/deal-stages",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    let stages = await db
      .select()
      .from(dealStagesTable)
      .where(eq(dealStagesTable.tenantId, tenantId))
      .orderBy(asc(dealStagesTable.position), asc(dealStagesTable.id));

    // Seed default pipeline for new tenants
    if (stages.length === 0) {
      stages = await db
        .insert(dealStagesTable)
        .values(
          DEFAULT_STAGES.map((s, i) => ({ tenantId, ...s, position: i })),
        )
        .returning();
    }
    res.json(stages);
  },
);

router.post(
  "/tenants/:tenantId/deal-stages",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = stageInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const [stage] = await db
      .insert(dealStagesTable)
      .values({
        tenantId,
        name: parsed.data.name.trim(),
        ...(parsed.data.color ? { color: parsed.data.color } : {}),
        position: parsed.data.position ?? 99,
      })
      .returning();
    res.status(201).json(stage);
  },
);

router.patch(
  "/tenants/:tenantId/deal-stages/:stageId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const stageId = Number(req.params["stageId"]);
    const parsed = stageInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates["name"] = parsed.data.name.trim();
    if (parsed.data.color !== undefined) updates["color"] = parsed.data.color;
    if (parsed.data.position !== undefined) updates["position"] = parsed.data.position;
    const [updated] = await db
      .update(dealStagesTable)
      .set(updates)
      .where(
        and(eq(dealStagesTable.id, stageId), eq(dealStagesTable.tenantId, tenantId)),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Stage not found" });
      return;
    }
    res.json(updated);
  },
);

router.delete(
  "/tenants/:tenantId/deal-stages/:stageId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const stageId = Number(req.params["stageId"]);
    const [dealInStage] = await db
      .select({ id: dealsTable.id })
      .from(dealsTable)
      .where(and(eq(dealsTable.stageId, stageId), eq(dealsTable.tenantId, tenantId)))
      .limit(1);
    if (dealInStage) {
      res
        .status(409)
        .json({ error: "Stage has deals. Move them to another stage first." });
      return;
    }
    await db
      .delete(dealStagesTable)
      .where(
        and(eq(dealStagesTable.id, stageId), eq(dealStagesTable.tenantId, tenantId)),
      );
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

router.get(
  "/tenants/:tenantId/deals",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conditions = [eq(dealsTable.tenantId, tenantId)];

    const stageId = req.query["stageId"] ? Number(req.query["stageId"]) : null;
    if (stageId) conditions.push(eq(dealsTable.stageId, stageId));

    const assignedTo = req.query["assignedTo"];
    if (typeof assignedTo === "string" && assignedTo)
      conditions.push(eq(dealsTable.assignedTo, assignedTo));

    const status = req.query["status"];
    if (status === "open" || status === "won" || status === "lost")
      conditions.push(eq(dealsTable.status, status));

    const from = req.query["from"];
    if (typeof from === "string" && from)
      conditions.push(gte(dealsTable.createdAt, new Date(from)));
    const to = req.query["to"];
    if (typeof to === "string" && to)
      conditions.push(lte(dealsTable.createdAt, new Date(to)));

    const rows = await db
      .select({
        deal: dealsTable,
        contactName: contactsTable.name,
        contactPhone: contactsTable.phone,
      })
      .from(dealsTable)
      .innerJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
      .where(and(...conditions))
      .orderBy(desc(dealsTable.updatedAt))
      .limit(500);

    res.json(
      rows.map((r) => ({
        ...r.deal,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
      })),
    );
  },
);

router.post(
  "/tenants/:tenantId/deals",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = dealInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    // Validate contact and stage belong to tenant
    const [contact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, parsed.data.contactId),
          eq(contactsTable.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!contact) {
      res.status(400).json({ error: "Contact not found in this tenant" });
      return;
    }
    const [stage] = await db
      .select({ id: dealStagesTable.id })
      .from(dealStagesTable)
      .where(
        and(
          eq(dealStagesTable.id, parsed.data.stageId),
          eq(dealStagesTable.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!stage) {
      res.status(400).json({ error: "Stage not found in this tenant" });
      return;
    }
    const [deal] = await db
      .insert(dealsTable)
      .values({
        tenantId,
        contactId: parsed.data.contactId,
        stageId: parsed.data.stageId,
        title: parsed.data.title.trim(),
        value: parsed.data.value != null ? String(parsed.data.value) : null,
        assignedTo: parsed.data.assignedTo ?? null,
        description: parsed.data.description ?? null,
        expectedCloseAt: parsed.data.expectedCloseAt
          ? new Date(parsed.data.expectedCloseAt)
          : null,
      })
      .returning();
    res.status(201).json(deal);
  },
);

router.patch(
  "/tenants/:tenantId/deals/:dealId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const dealId = Number(req.params["dealId"]);
    const parsed = dealPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const d = parsed.data;
    if (d.stageId !== undefined) {
      const [stage] = await db
        .select({ id: dealStagesTable.id })
        .from(dealStagesTable)
        .where(
          and(eq(dealStagesTable.id, d.stageId), eq(dealStagesTable.tenantId, tenantId)),
        )
        .limit(1);
      if (!stage) {
        res.status(400).json({ error: "Stage not found in this tenant" });
        return;
      }
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (d.title !== undefined) updates["title"] = d.title.trim();
    if (d.stageId !== undefined) updates["stageId"] = d.stageId;
    if (d.value !== undefined)
      updates["value"] = d.value != null ? String(d.value) : null;
    if (d.assignedTo !== undefined) updates["assignedTo"] = d.assignedTo;
    if (d.description !== undefined) updates["description"] = d.description;
    if (d.expectedCloseAt !== undefined)
      updates["expectedCloseAt"] = d.expectedCloseAt
        ? new Date(d.expectedCloseAt)
        : null;
    if (d.status !== undefined) {
      updates["status"] = d.status;
      updates["closedAt"] = d.status === "open" ? null : new Date();
    }
    const [updated] = await db
      .update(dealsTable)
      .set(updates)
      .where(and(eq(dealsTable.id, dealId), eq(dealsTable.tenantId, tenantId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    res.json(updated);
  },
);

router.delete(
  "/tenants/:tenantId/deals/:dealId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const dealId = Number(req.params["dealId"]);
    await db
      .delete(dealsTable)
      .where(and(eq(dealsTable.id, dealId), eq(dealsTable.tenantId, tenantId)));
    res.status(204).end();
  },
);

export default router;
