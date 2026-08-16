/**
 * Tag management routes (CRM).
 */
import { Router, type IRouter } from "express";
import { db, tagsTable, contactTagsTable, conversationTagsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";

const router: IRouter = Router();

const tagInputSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

router.get(
  "/tenants/:tenantId/tags",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const tags = await db
      .select()
      .from(tagsTable)
      .where(eq(tagsTable.tenantId, tenantId))
      .orderBy(asc(tagsTable.name));
    res.json(tags);
  },
);

router.post(
  "/tenants/:tenantId/tags",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = tagInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    try {
      const [tag] = await db
        .insert(tagsTable)
        .values({
          tenantId,
          name: parsed.data.name.trim(),
          ...(parsed.data.color ? { color: parsed.data.color } : {}),
        })
        .returning();
      res.status(201).json(tag);
    } catch {
      res.status(409).json({ error: "Tag with this name already exists" });
    }
  },
);

router.patch(
  "/tenants/:tenantId/tags/:tagId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const tagId = Number(req.params["tagId"]);
    const parsed = tagInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates["name"] = parsed.data.name.trim();
    if (parsed.data.color !== undefined) updates["color"] = parsed.data.color;
    const [updated] = await db
      .update(tagsTable)
      .set(updates)
      .where(and(eq(tagsTable.id, tagId), eq(tagsTable.tenantId, tenantId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Tag not found" });
      return;
    }
    res.json(updated);
  },
);

router.delete(
  "/tenants/:tenantId/tags/:tagId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const tagId = Number(req.params["tagId"]);
    await db.transaction(async (tx) => {
      await tx
        .delete(contactTagsTable)
        .where(and(eq(contactTagsTable.tagId, tagId), eq(contactTagsTable.tenantId, tenantId)));
      await tx
        .delete(conversationTagsTable)
        .where(
          and(
            eq(conversationTagsTable.tagId, tagId),
            eq(conversationTagsTable.tenantId, tenantId),
          ),
        );
      await tx
        .delete(tagsTable)
        .where(and(eq(tagsTable.id, tagId), eq(tagsTable.tenantId, tenantId)));
    });
    res.status(204).end();
  },
);

export default router;
