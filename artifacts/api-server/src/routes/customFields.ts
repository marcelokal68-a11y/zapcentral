/**
 * Custom field definitions per tenant (CRM).
 */
import { Router, type IRouter } from "express";
import { db, customFieldsTable, customFieldValuesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";

const router: IRouter = Router();

const fieldInputSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(["text", "number", "date", "select"]).optional(),
  options: z.array(z.string().min(1).max(60)).max(50).optional(),
  position: z.number().int().min(0).optional(),
});

router.get(
  "/tenants/:tenantId/custom-fields",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const fields = await db
      .select()
      .from(customFieldsTable)
      .where(eq(customFieldsTable.tenantId, tenantId))
      .orderBy(asc(customFieldsTable.position), asc(customFieldsTable.id));
    res.json(fields);
  },
);

router.post(
  "/tenants/:tenantId/custom-fields",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = fieldInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    if (parsed.data.type === "select" && !parsed.data.options?.length) {
      res.status(400).json({ error: "Select fields require options" });
      return;
    }
    try {
      const [field] = await db
        .insert(customFieldsTable)
        .values({
          tenantId,
          name: parsed.data.name.trim(),
          type: parsed.data.type ?? "text",
          options: parsed.data.options ?? null,
          position: parsed.data.position ?? 0,
        })
        .returning();
      res.status(201).json(field);
    } catch {
      res.status(409).json({ error: "Field with this name already exists" });
    }
  },
);

router.patch(
  "/tenants/:tenantId/custom-fields/:fieldId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const fieldId = Number(req.params["fieldId"]);
    const parsed = fieldInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates["name"] = parsed.data.name.trim();
    if (parsed.data.type !== undefined) updates["type"] = parsed.data.type;
    if (parsed.data.options !== undefined) updates["options"] = parsed.data.options;
    if (parsed.data.position !== undefined) updates["position"] = parsed.data.position;
    const [updated] = await db
      .update(customFieldsTable)
      .set(updates)
      .where(
        and(eq(customFieldsTable.id, fieldId), eq(customFieldsTable.tenantId, tenantId)),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Field not found" });
      return;
    }
    res.json(updated);
  },
);

router.delete(
  "/tenants/:tenantId/custom-fields/:fieldId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const fieldId = Number(req.params["fieldId"]);
    await db.transaction(async (tx) => {
      await tx
        .delete(customFieldValuesTable)
        .where(
          and(
            eq(customFieldValuesTable.fieldId, fieldId),
            eq(customFieldValuesTable.tenantId, tenantId),
          ),
        );
      await tx
        .delete(customFieldsTable)
        .where(
          and(eq(customFieldsTable.id, fieldId), eq(customFieldsTable.tenantId, tenantId)),
        );
    });
    res.status(204).end();
  },
);

export default router;
