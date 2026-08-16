/**
 * CRM contact routes: CRUD, search/filters, merge, CSV import/export,
 * notes, tags on contacts/conversations, custom field values, bulk actions.
 */
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  contactsTable,
  conversationsTable,
  contactNotesTable,
  tagsTable,
  contactTagsTable,
  conversationTagsTable,
  customFieldsTable,
  customFieldValuesTable,
  dealsTable,
  dealStagesTable,
} from "@workspace/db";
import { eq, and, or, ilike, desc, asc, inArray, sql, count } from "drizzle-orm";
import { z } from "zod";
import {
  requireAuth,
  requireTenantMember,
  requireTenantAdmin,
} from "../middlewares/auth";
import { isValidCpf, normalizeCpf } from "../lib/cpf";

/** Maps a unique-constraint violation to a user-facing conflict message. */
function conflictMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text.includes("contacts_tenant_cpf_idx"))
    return "Já existe um cliente com este CPF";
  return "Contact with this phone already exists";
}

const router: IRouter = Router();

const contactInputSchema = z.object({
  phone: z.string().min(8).max(20).regex(/^\d+$/, "Digits only"),
  name: z.string().max(120).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  cpf: z
    .string()
    .max(20)
    .transform((v) => normalizeCpf(v))
    .refine((v) => isValidCpf(v), { message: "CPF inválido" })
    .nullable()
    .optional(),
  origin: z.enum(["invite", "qr", "organic"]).optional(),
  company: z.string().max(120).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  assignedTo: z.string().max(100).nullable().optional(),
});

const contactPatchSchema = contactInputSchema.partial();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getTagsForContacts(tenantId: number, contactIds: number[]) {
  if (contactIds.length === 0)
    return new Map<number, { id: number; name: string; color: string }[]>();
  const rows = await db
    .select({
      contactId: contactTagsTable.contactId,
      id: tagsTable.id,
      name: tagsTable.name,
      color: tagsTable.color,
    })
    .from(contactTagsTable)
    .innerJoin(tagsTable, eq(contactTagsTable.tagId, tagsTable.id))
    .where(
      and(
        eq(contactTagsTable.tenantId, tenantId),
        inArray(contactTagsTable.contactId, contactIds),
      ),
    );
  const map = new Map<number, { id: number; name: string; color: string }[]>();
  for (const r of rows) {
    const list = map.get(r.contactId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.contactId, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/contacts — list with search + filters + pagination
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/contacts",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const page = Math.max(1, Number(req.query["page"]) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query["limit"]) || 25));

    const conditions = [eq(contactsTable.tenantId, tenantId)];

    const q = req.query["q"];
    if (typeof q === "string" && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push(
        or(
          ilike(contactsTable.name, term),
          ilike(contactsTable.phone, term),
          ilike(contactsTable.email, term),
          ilike(contactsTable.company, term),
        )!,
      );
    }

    const assignedTo = req.query["assignedTo"];
    if (typeof assignedTo === "string" && assignedTo)
      conditions.push(eq(contactsTable.assignedTo, assignedTo));

    const tagId = req.query["tagId"] ? Number(req.query["tagId"]) : null;
    if (tagId) {
      conditions.push(
        inArray(
          contactsTable.id,
          db
            .select({ id: contactTagsTable.contactId })
            .from(contactTagsTable)
            .where(
              and(
                eq(contactTagsTable.tagId, tagId),
                eq(contactTagsTable.tenantId, tenantId),
              ),
            ),
        ),
      );
    }

    const where = and(...conditions);
    const [totalRow] = await db
      .select({ total: count() })
      .from(contactsTable)
      .where(where);
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(where)
      .orderBy(desc(contactsTable.lastContactAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const tagMap = await getTagsForContacts(
      tenantId,
      contacts.map((c) => c.id),
    );

    res.json({
      contacts: contacts.map((c) => ({ ...c, tags: tagMap.get(c.id) ?? [] })),
      total: totalRow?.total ?? 0,
      page,
      limit,
    });
  },
);

// ---------------------------------------------------------------------------
// CSV export (before /:contactId to avoid route capture)
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/contacts/export",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.tenantId, tenantId))
      .orderBy(asc(contactsTable.id));
    const esc = (v: string | null) => {
      if (v == null) return "";
      // Neutralize spreadsheet formula injection (=, +, -, @, tab/CR-prefixed)
      const safe = /^[\s]*[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = ["name,phone,cpf,email,company,notes"];
    for (const c of contacts) {
      lines.push(
        [esc(c.name), esc(c.phone), esc(c.cpf), esc(c.email), esc(c.company), esc(c.notes)].join(","),
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=contatos.csv");
    res.send(lines.join("\n"));
  },
);

// ---------------------------------------------------------------------------
// CSV import — body: { csv: string } with header name,phone,email,company,notes
// ---------------------------------------------------------------------------
const importSchema = z.object({ csv: z.string().min(1).max(2_000_000) });

/** RFC-4180 CSV parser: handles quoted fields containing commas, quotes and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

router.post(
  "/tenants/:tenantId/contacts/import",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const rows = parseCsv(parsed.data.csv);
    if (rows.length < 2) {
      res.status(400).json({ error: "CSV must have a header and at least one row" });
      return;
    }
    const header = rows[0]!.map((h) => h.trim().toLowerCase());
    const idx = {
      name: header.indexOf("name") !== -1 ? header.indexOf("name") : header.indexOf("nome"),
      phone:
        header.indexOf("phone") !== -1
          ? header.indexOf("phone")
          : header.indexOf("telefone"),
      email: header.indexOf("email"),
      company:
        header.indexOf("company") !== -1
          ? header.indexOf("company")
          : header.indexOf("empresa"),
      notes:
        header.indexOf("notes") !== -1
          ? header.indexOf("notes")
          : header.indexOf("notas"),
      cpf: header.indexOf("cpf"),
    };
    if (idx.phone === -1) {
      res.status(400).json({ error: "CSV must have a 'phone'/'telefone' column" });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i]!;
      const phone = (cols[idx.phone] ?? "").replace(/\D/g, "");
      if (!phone || phone.length < 8) {
        skipped++;
        errors.push(`Linha ${i + 1}: telefone inválido`);
        continue;
      }
      const val = (j: number) => (j >= 0 ? cols[j]?.trim() || null : null);
      const rawCpf = val(idx.cpf);
      let cpf: string | null = null;
      if (rawCpf) {
        const normalized = normalizeCpf(rawCpf);
        if (!isValidCpf(normalized)) {
          skipped++;
          errors.push(`Linha ${i + 1}: CPF inválido`);
          continue;
        }
        cpf = normalized;
      }
      try {
        await db
          .insert(contactsTable)
          .values({
            tenantId,
            phone,
            name: val(idx.name),
            email: val(idx.email),
            cpf,
            origin: "invite",
            company: val(idx.company),
            notes: val(idx.notes),
          })
          .onConflictDoUpdate({
            target: [contactsTable.tenantId, contactsTable.phone],
            set: {
              name: sql`COALESCE(EXCLUDED.name, ${contactsTable.name})`,
              email: sql`COALESCE(EXCLUDED.email, ${contactsTable.email})`,
              cpf: sql`COALESCE(EXCLUDED.cpf, ${contactsTable.cpf})`,
              company: sql`COALESCE(EXCLUDED.company, ${contactsTable.company})`,
              updatedAt: new Date(),
            },
          });
        imported++;
      } catch {
        skipped++;
        errors.push(`Linha ${i + 1}: erro ao importar`);
      }
    }
    res.json({ imported, skipped, errors: errors.slice(0, 20) });
  },
);

// ---------------------------------------------------------------------------
// Merge duplicates — body: { primaryId, duplicateId }
// ---------------------------------------------------------------------------
const mergeSchema = z.object({
  primaryId: z.number().int(),
  duplicateId: z.number().int(),
});

router.post(
  "/tenants/:tenantId/contacts/merge",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = mergeSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.primaryId === parsed.data.duplicateId) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const { primaryId, duplicateId } = parsed.data;

    try {
      const merged = await db.transaction(async (tx) => {
        const [primary] = await tx
          .select()
          .from(contactsTable)
          .where(and(eq(contactsTable.id, primaryId), eq(contactsTable.tenantId, tenantId)))
          .for("update");
        const [dup] = await tx
          .select()
          .from(contactsTable)
          .where(
            and(eq(contactsTable.id, duplicateId), eq(contactsTable.tenantId, tenantId)),
          )
          .for("update");
        if (!primary || !dup) throw new Error("NOT_FOUND");

        // Re-point child records
        await tx
          .update(conversationsTable)
          .set({ contactId: primaryId })
          .where(
            and(
              eq(conversationsTable.contactId, duplicateId),
              eq(conversationsTable.tenantId, tenantId),
            ),
          );
        await tx
          .update(dealsTable)
          .set({ contactId: primaryId })
          .where(
            and(eq(dealsTable.contactId, duplicateId), eq(dealsTable.tenantId, tenantId)),
          );
        await tx
          .update(contactNotesTable)
          .set({ contactId: primaryId })
          .where(
            and(
              eq(contactNotesTable.contactId, duplicateId),
              eq(contactNotesTable.tenantId, tenantId),
            ),
          );
        // Tags: move only those the primary doesn't have yet
        const dupTags = await tx
          .select({ tagId: contactTagsTable.tagId })
          .from(contactTagsTable)
          .where(eq(contactTagsTable.contactId, duplicateId));
        for (const t of dupTags) {
          await tx
            .insert(contactTagsTable)
            .values({ contactId: primaryId, tagId: t.tagId, tenantId })
            .onConflictDoNothing();
        }
        await tx
          .delete(contactTagsTable)
          .where(eq(contactTagsTable.contactId, duplicateId));
        // Custom values: keep primary's, adopt duplicate's for missing fields
        const dupValues = await tx
          .select()
          .from(customFieldValuesTable)
          .where(eq(customFieldValuesTable.contactId, duplicateId));
        for (const v of dupValues) {
          await tx
            .insert(customFieldValuesTable)
            .values({
              contactId: primaryId,
              fieldId: v.fieldId,
              tenantId,
              value: v.value,
            })
            .onConflictDoNothing();
        }
        await tx
          .delete(customFieldValuesTable)
          .where(eq(customFieldValuesTable.contactId, duplicateId));

        // Fill missing scalar fields on primary from duplicate
        const [updated] = await tx
          .update(contactsTable)
          .set({
            name: primary.name ?? dup.name,
            email: primary.email ?? dup.email,
            company: primary.company ?? dup.company,
            avatarUrl: primary.avatarUrl ?? dup.avatarUrl,
            assignedTo: primary.assignedTo ?? dup.assignedTo,
            notes:
              primary.notes && dup.notes
                ? `${primary.notes}\n---\n${dup.notes}`
                : (primary.notes ?? dup.notes),
            firstContactAt:
              dup.firstContactAt < primary.firstContactAt
                ? dup.firstContactAt
                : primary.firstContactAt,
            lastContactAt:
              dup.lastContactAt > primary.lastContactAt
                ? dup.lastContactAt
                : primary.lastContactAt,
            updatedAt: new Date(),
          })
          .where(eq(contactsTable.id, primaryId))
          .returning();

        await tx.delete(contactsTable).where(eq(contactsTable.id, duplicateId));
        return updated;
      });
      res.json(merged);
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        res.status(404).json({ error: "Contact not found" });
        return;
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Bulk actions — body: { contactIds, addTagId?, assignedTo? }
// ---------------------------------------------------------------------------
const bulkSchema = z.object({
  contactIds: z.array(z.number().int()).min(1).max(500),
  addTagId: z.number().int().optional(),
  assignedTo: z.string().max(100).nullable().optional(),
});

router.post(
  "/tenants/:tenantId/contacts/bulk",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const { contactIds, addTagId, assignedTo } = parsed.data;

    // Only touch contacts belonging to this tenant
    const owned = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(
        and(eq(contactsTable.tenantId, tenantId), inArray(contactsTable.id, contactIds)),
      );
    const ownedIds = owned.map((o) => o.id);
    if (ownedIds.length === 0) {
      res.json({ updated: 0 });
      return;
    }

    if (addTagId !== undefined) {
      const [tag] = await db
        .select({ id: tagsTable.id })
        .from(tagsTable)
        .where(and(eq(tagsTable.id, addTagId), eq(tagsTable.tenantId, tenantId)))
        .limit(1);
      if (!tag) {
        res.status(400).json({ error: "Tag not found" });
        return;
      }
      await db
        .insert(contactTagsTable)
        .values(ownedIds.map((id) => ({ contactId: id, tagId: addTagId, tenantId })))
        .onConflictDoNothing();
    }
    if (assignedTo !== undefined) {
      await db
        .update(contactsTable)
        .set({ assignedTo, updatedAt: new Date() })
        .where(inArray(contactsTable.id, ownedIds));
    }
    res.json({ updated: ownedIds.length });
  },
);

// ---------------------------------------------------------------------------
// POST /tenants/:tenantId/contacts — manual creation
// ---------------------------------------------------------------------------
router.post(
  "/tenants/:tenantId/contacts",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const parsed = contactInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    try {
      const [contact] = await db
        .insert(contactsTable)
        .values({ tenantId, ...parsed.data })
        .returning();
      res.status(201).json(contact);
    } catch (err) {
      res.status(409).json({ error: conflictMessage(err) });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /tenants/:tenantId/contacts/:contactId — full profile
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/contacts/:contactId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);

    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.tenantId, tenantId)))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    const [tagMap, conversations, deals, notes, fields, values] = await Promise.all([
      getTagsForContacts(tenantId, [contactId]),
      db
        .select()
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.contactId, contactId),
            eq(conversationsTable.tenantId, tenantId),
          ),
        )
        .orderBy(desc(conversationsTable.lastMessageAt))
        .limit(30),
      db
        .select({
          deal: dealsTable,
          stageName: dealStagesTable.name,
          stageColor: dealStagesTable.color,
        })
        .from(dealsTable)
        .innerJoin(dealStagesTable, eq(dealsTable.stageId, dealStagesTable.id))
        .where(
          and(eq(dealsTable.contactId, contactId), eq(dealsTable.tenantId, tenantId)),
        )
        .orderBy(desc(dealsTable.updatedAt)),
      db
        .select()
        .from(contactNotesTable)
        .where(
          and(
            eq(contactNotesTable.contactId, contactId),
            eq(contactNotesTable.tenantId, tenantId),
          ),
        )
        .orderBy(desc(contactNotesTable.createdAt))
        .limit(100),
      db
        .select()
        .from(customFieldsTable)
        .where(eq(customFieldsTable.tenantId, tenantId))
        .orderBy(asc(customFieldsTable.position), asc(customFieldsTable.id)),
      db
        .select()
        .from(customFieldValuesTable)
        .where(
          and(
            eq(customFieldValuesTable.contactId, contactId),
            eq(customFieldValuesTable.tenantId, tenantId),
          ),
        ),
    ]);

    const valueByField = new Map(values.map((v) => [v.fieldId, v.value]));

    res.json({
      ...contact,
      tags: tagMap.get(contactId) ?? [],
      conversations,
      deals: deals.map((d) => ({
        ...d.deal,
        stageName: d.stageName,
        stageColor: d.stageColor,
      })),
      notes,
      customFields: fields.map((f) => ({
        ...f,
        value: valueByField.get(f.id) ?? null,
      })),
    });
  },
);

// ---------------------------------------------------------------------------
// PATCH / DELETE contact
// ---------------------------------------------------------------------------
router.patch(
  "/tenants/:tenantId/contacts/:contactId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);
    const parsed = contactPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) updates[k] = v;
    }
    try {
      const [updated] = await db
        .update(contactsTable)
        .set(updates)
        .where(
          and(eq(contactsTable.id, contactId), eq(contactsTable.tenantId, tenantId)),
        )
        .returning();
      if (!updated) {
        res.status(404).json({ error: "Contact not found" });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(409).json({ error: conflictMessage(err) });
    }
  },
);

router.delete(
  "/tenants/:tenantId/contacts/:contactId",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);
    const [conv] = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.contactId, contactId),
          eq(conversationsTable.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (conv) {
      res.status(409).json({
        error:
          "Contact has conversations. Merge it into another contact instead of deleting.",
      });
      return;
    }
    await db
      .delete(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.tenantId, tenantId)));
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Custom field values — PUT /contacts/:contactId/custom-values
// ---------------------------------------------------------------------------
const customValuesSchema = z.object({
  values: z
    .array(
      z.object({
        fieldId: z.number().int(),
        value: z.string().max(1000).nullable(),
      }),
    )
    .min(1)
    .max(100),
});

router.put(
  "/tenants/:tenantId/contacts/:contactId/custom-values",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);
    const parsed = customValuesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const [contact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.tenantId, tenantId)))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    const tenantFields = await db
      .select({ id: customFieldsTable.id })
      .from(customFieldsTable)
      .where(eq(customFieldsTable.tenantId, tenantId));
    const fieldIds = new Set(tenantFields.map((f) => f.id));

    for (const v of parsed.data.values) {
      if (!fieldIds.has(v.fieldId)) continue;
      if (v.value == null || v.value === "") {
        await db
          .delete(customFieldValuesTable)
          .where(
            and(
              eq(customFieldValuesTable.contactId, contactId),
              eq(customFieldValuesTable.fieldId, v.fieldId),
            ),
          );
      } else {
        await db
          .insert(customFieldValuesTable)
          .values({ contactId, fieldId: v.fieldId, tenantId, value: v.value })
          .onConflictDoUpdate({
            target: [customFieldValuesTable.contactId, customFieldValuesTable.fieldId],
            set: { value: v.value, updatedAt: new Date() },
          });
      }
    }
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
const noteInputSchema = z.object({
  content: z.string().min(1).max(5000),
  conversationId: z.number().int().nullable().optional(),
});

router.get(
  "/tenants/:tenantId/contacts/:contactId/notes",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);
    const notes = await db
      .select()
      .from(contactNotesTable)
      .where(
        and(
          eq(contactNotesTable.contactId, contactId),
          eq(contactNotesTable.tenantId, tenantId),
        ),
      )
      .orderBy(desc(contactNotesTable.createdAt))
      .limit(200);
    res.json(notes);
  },
);

router.post(
  "/tenants/:tenantId/contacts/:contactId/notes",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);
    const auth = getAuth(req);
    const parsed = noteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.format() });
      return;
    }
    const [contact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.tenantId, tenantId)))
      .limit(1);
    if (!contact) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    if (parsed.data.conversationId != null) {
      const [conv] = await db
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(
          and(
            eq(conversationsTable.id, parsed.data.conversationId),
            eq(conversationsTable.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!conv) {
        res.status(400).json({ error: "Conversation not found" });
        return;
      }
    }
    const [note] = await db
      .insert(contactNotesTable)
      .values({
        tenantId,
        contactId,
        conversationId: parsed.data.conversationId ?? null,
        authorId: auth.userId!,
        content: parsed.data.content,
      })
      .returning();
    res.status(201).json(note);
  },
);

router.delete(
  "/tenants/:tenantId/notes/:noteId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const noteId = Number(req.params["noteId"]);
    const auth = getAuth(req);
    const [note] = await db
      .select()
      .from(contactNotesTable)
      .where(
        and(eq(contactNotesTable.id, noteId), eq(contactNotesTable.tenantId, tenantId)),
      )
      .limit(1);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    if (note.authorId !== auth.userId) {
      res.status(403).json({ error: "Only the author can delete a note" });
      return;
    }
    await db.delete(contactNotesTable).where(eq(contactNotesTable.id, noteId));
    res.status(204).end();
  },
);

// Notes scoped to a conversation (for the chat panel)
router.get(
  "/tenants/:tenantId/conversations/:conversationId/notes",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const notes = await db
      .select()
      .from(contactNotesTable)
      .where(
        and(
          eq(contactNotesTable.conversationId, conversationId),
          eq(contactNotesTable.tenantId, tenantId),
        ),
      )
      .orderBy(desc(contactNotesTable.createdAt))
      .limit(100);
    res.json(notes);
  },
);

// ---------------------------------------------------------------------------
// Contact tags
// ---------------------------------------------------------------------------
const tagRefSchema = z.object({ tagId: z.number().int() });

router.post(
  "/tenants/:tenantId/contacts/:contactId/tags",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);
    const parsed = tagRefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [contact] = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(and(eq(contactsTable.id, contactId), eq(contactsTable.tenantId, tenantId)))
      .limit(1);
    const [tag] = await db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(and(eq(tagsTable.id, parsed.data.tagId), eq(tagsTable.tenantId, tenantId)))
      .limit(1);
    if (!contact || !tag) {
      res.status(404).json({ error: "Contact or tag not found" });
      return;
    }
    await db
      .insert(contactTagsTable)
      .values({ contactId, tagId: parsed.data.tagId, tenantId })
      .onConflictDoNothing();
    res.status(201).json({ ok: true });
  },
);

router.delete(
  "/tenants/:tenantId/contacts/:contactId/tags/:tagId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const contactId = Number(req.params["contactId"]);
    const tagId = Number(req.params["tagId"]);
    await db
      .delete(contactTagsTable)
      .where(
        and(
          eq(contactTagsTable.contactId, contactId),
          eq(contactTagsTable.tagId, tagId),
          eq(contactTagsTable.tenantId, tenantId),
        ),
      );
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Conversation tags
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/conversations/:conversationId/tags",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const rows = await db
      .select({ id: tagsTable.id, name: tagsTable.name, color: tagsTable.color })
      .from(conversationTagsTable)
      .innerJoin(tagsTable, eq(conversationTagsTable.tagId, tagsTable.id))
      .where(
        and(
          eq(conversationTagsTable.conversationId, conversationId),
          eq(conversationTagsTable.tenantId, tenantId),
        ),
      );
    res.json(rows);
  },
);

router.post(
  "/tenants/:tenantId/conversations/:conversationId/tags",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const parsed = tagRefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [conv] = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.id, conversationId),
          eq(conversationsTable.tenantId, tenantId),
        ),
      )
      .limit(1);
    const [tag] = await db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(and(eq(tagsTable.id, parsed.data.tagId), eq(tagsTable.tenantId, tenantId)))
      .limit(1);
    if (!conv || !tag) {
      res.status(404).json({ error: "Conversation or tag not found" });
      return;
    }
    await db
      .insert(conversationTagsTable)
      .values({ conversationId, tagId: parsed.data.tagId, tenantId })
      .onConflictDoNothing();
    res.status(201).json({ ok: true });
  },
);

router.delete(
  "/tenants/:tenantId/conversations/:conversationId/tags/:tagId",
  requireAuth,
  requireTenantMember,
  async (req, res): Promise<void> => {
    const tenantId = Number(req.params["tenantId"]);
    const conversationId = Number(req.params["conversationId"]);
    const tagId = Number(req.params["tagId"]);
    await db
      .delete(conversationTagsTable)
      .where(
        and(
          eq(conversationTagsTable.conversationId, conversationId),
          eq(conversationTagsTable.tagId, tagId),
          eq(conversationTagsTable.tenantId, tenantId),
        ),
      );
    res.status(204).end();
  },
);

export default router;
