/**
 * Reports & analytics routes.
 * Aggregated metrics over conversations, messages, agents, departments and deals.
 * All endpoints accept from/to (ISO dates) plus optional departmentId/agentId/tagId filters.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { requireAuth, requireTenantAdmin } from "../middlewares/auth";

const router: IRouter = Router();

interface Filters {
  tenantId: number;
  from: Date;
  to: Date;
  departmentId: number | null;
  agentId: string | null;
  tagId: number | null;
}

function parseFilters(req: {
  params: Record<string, string>;
  query: Record<string, unknown>;
}): Filters {
  const tenantId = Number(req.params["tenantId"]);
  const now = new Date();
  const fromRaw = req.query["from"];
  const toRaw = req.query["to"];
  const from =
    typeof fromRaw === "string" && !isNaN(Date.parse(fromRaw))
      ? new Date(fromRaw)
      : new Date(now.getTime() - 30 * 86_400_000);
  const to =
    typeof toRaw === "string" && !isNaN(Date.parse(toRaw)) ? new Date(toRaw) : now;
  const departmentId = req.query["departmentId"]
    ? Number(req.query["departmentId"])
    : null;
  const agentId =
    typeof req.query["agentId"] === "string" && req.query["agentId"]
      ? (req.query["agentId"] as string)
      : null;
  const tagId = req.query["tagId"] ? Number(req.query["tagId"]) : null;
  return { tenantId, from, to, departmentId, agentId, tagId };
}

/** WHERE fragment applied to conversations c within the period + filters. */
function convWhere(f: Filters): SQL {
  const parts: SQL[] = [
    sql`c.tenant_id = ${f.tenantId}`,
    sql`c.created_at >= ${f.from}`,
    sql`c.created_at <= ${f.to}`,
  ];
  if (f.departmentId) parts.push(sql`c.department_id = ${f.departmentId}`);
  if (f.agentId) parts.push(sql`c.assigned_to = ${f.agentId}`);
  if (f.tagId)
    // Match both conversation-level tags and CRM contact-level tags
    parts.push(
      sql`(EXISTS (SELECT 1 FROM conversation_tags ct WHERE ct.conversation_id = c.id AND ct.tag_id = ${f.tagId})
        OR EXISTS (SELECT 1 FROM contact_tags cot WHERE cot.contact_id = c.contact_id AND cot.tag_id = ${f.tagId} AND cot.tenant_id = ${f.tenantId}))`,
    );
  return sql.join(parts, sql` AND `);
}

/**
 * Reusable CTE: per-conversation timing metrics.
 * first_response_secs — seconds between conversation start and first outbound message
 * resolution_secs — seconds between start and close
 */
const timingCte = (where: SQL) => sql`
  WITH conv AS (
    SELECT
      c.id, c.tenant_id, c.department_id, c.assigned_to, c.status,
      c.created_at, c.closed_at,
      EXTRACT(EPOCH FROM (
        (SELECT MIN(m.timestamp) FROM messages m
          WHERE m.conversation_id = c.id AND m.direction = 'outbound')
        - c.created_at
      )) AS first_response_secs,
      CASE WHEN c.closed_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (c.closed_at - c.created_at))
        ELSE NULL END AS resolution_secs
    FROM conversations c
    WHERE ${where}
  )
`;

// ---------------------------------------------------------------------------
// GET /reports/overview — KPI cards
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/reports/overview",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const f = parseFilters(req as never);

    const [periodAgg, liveAgg] = await Promise.all([
      db.execute(sql`
        ${timingCte(convWhere(f))}
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
          ROUND(AVG(first_response_secs) FILTER (WHERE first_response_secs >= 0))::int AS avg_first_response_secs,
          ROUND(AVG(resolution_secs))::int AS avg_resolution_secs
        FROM conv
      `),
      // Live snapshot ignores the period — always "right now"
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
          COUNT(*) FILTER (WHERE status IN ('new','ivr'))::int AS in_ivr,
          COUNT(*) FILTER (WHERE status = 'closed' AND closed_at >= CURRENT_DATE)::int AS closed_today
        FROM conversations c
        WHERE c.tenant_id = ${f.tenantId}
      `),
    ]);

    const p = periodAgg.rows[0] ?? {};
    const l = liveAgg.rows[0] ?? {};
    res.json({
      period: {
        total: p["total"] ?? 0,
        closed: p["closed"] ?? 0,
        avgFirstResponseSecs: p["avg_first_response_secs"],
        avgResolutionSecs: p["avg_resolution_secs"],
      },
      live: {
        active: l["active"] ?? 0,
        waiting: l["waiting"] ?? 0,
        inIvr: l["in_ivr"] ?? 0,
        closedToday: l["closed_today"] ?? 0,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /reports/volume?granularity=hour|day|week|month — time series
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/reports/volume",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const f = parseFilters(req as never);
    const g = String(req.query["granularity"] ?? "day");
    const granularity = ["hour", "day", "week", "month"].includes(g) ? g : "day";

    const result = await db.execute(sql`
      SELECT
        date_trunc(${granularity}, c.created_at) AS bucket,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE c.status = 'closed')::int AS closed
      FROM conversations c
      WHERE ${convWhere(f)}
      GROUP BY 1
      ORDER BY 1
    `);
    res.json(
      result.rows.map((r) => ({
        bucket: r["bucket"],
        total: r["total"],
        closed: r["closed"],
      })),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /reports/agents — productivity ranking
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/reports/agents",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const f = parseFilters(req as never);
    const result = await db.execute(sql`
      ${timingCte(convWhere(f))}
      SELECT
        assigned_to AS agent_id,
        COUNT(*)::int AS handled,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
        ROUND(AVG(first_response_secs) FILTER (WHERE first_response_secs >= 0))::int AS avg_first_response_secs,
        ROUND(AVG(resolution_secs))::int AS avg_resolution_secs
      FROM conv
      WHERE assigned_to IS NOT NULL
      GROUP BY assigned_to
      ORDER BY handled DESC
    `);
    res.json(
      result.rows.map((r) => ({
        agentId: r["agent_id"],
        handled: r["handled"],
        closed: r["closed"],
        avgFirstResponseSecs: r["avg_first_response_secs"],
        avgResolutionSecs: r["avg_resolution_secs"],
      })),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /reports/departments — volume, SLA, resolution rate
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/reports/departments",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const f = parseFilters(req as never);
    const result = await db.execute(sql`
      ${timingCte(convWhere(f))}
      SELECT
        d.id AS department_id,
        d.name AS department_name,
        d.color AS department_color,
        COUNT(conv.id)::int AS total,
        COUNT(conv.id) FILTER (WHERE conv.status = 'closed')::int AS closed,
        ROUND(AVG(conv.first_response_secs) FILTER (WHERE conv.first_response_secs >= 0))::int AS avg_first_response_secs,
        ROUND(AVG(conv.resolution_secs))::int AS avg_resolution_secs
      FROM departments d
      LEFT JOIN conv ON conv.department_id = d.id
      WHERE d.tenant_id = ${f.tenantId}
      GROUP BY d.id, d.name, d.color
      ORDER BY total DESC
    `);
    res.json(
      result.rows.map((r) => ({
        departmentId: r["department_id"],
        departmentName: r["department_name"],
        departmentColor: r["department_color"],
        total: r["total"],
        closed: r["closed"],
        resolutionRate:
          Number(r["total"]) > 0
            ? Math.round((Number(r["closed"]) / Number(r["total"])) * 100)
            : null,
        avgFirstResponseSecs: r["avg_first_response_secs"],
        avgResolutionSecs: r["avg_resolution_secs"],
      })),
    );
  },
);

// ---------------------------------------------------------------------------
// GET /reports/funnel — deals per stage + won/lost in period
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/reports/funnel",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const f = parseFilters(req as never);
    const [stages, closedDeals] = await Promise.all([
      db.execute(sql`
        SELECT
          s.id, s.name, s.color, s.position,
          COUNT(d.id) FILTER (WHERE d.status = 'open')::int AS open_count,
          COALESCE(SUM(d.value) FILTER (WHERE d.status = 'open'), 0) AS open_value
        FROM deal_stages s
        LEFT JOIN deals d ON d.stage_id = s.id AND d.tenant_id = ${f.tenantId}
        WHERE s.tenant_id = ${f.tenantId}
        GROUP BY s.id, s.name, s.color, s.position
        ORDER BY s.position, s.id
      `),
      db.execute(sql`
        SELECT
          status,
          COUNT(*)::int AS count,
          COALESCE(SUM(value), 0) AS value
        FROM deals
        WHERE tenant_id = ${f.tenantId}
          AND status IN ('won','lost')
          AND closed_at >= ${f.from} AND closed_at <= ${f.to}
        GROUP BY status
      `),
    ]);

    const won = closedDeals.rows.find((r) => r["status"] === "won");
    const lost = closedDeals.rows.find((r) => r["status"] === "lost");
    res.json({
      stages: stages.rows.map((r) => ({
        stageId: r["id"],
        name: r["name"],
        color: r["color"],
        position: r["position"],
        openCount: r["open_count"],
        openValue: String(r["open_value"]),
      })),
      won: { count: won?.["count"] ?? 0, value: String(won?.["value"] ?? 0) },
      lost: { count: lost?.["count"] ?? 0, value: String(lost?.["value"] ?? 0) },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /reports/conversations — detailed table (+ CSV via ?format=csv)
// ---------------------------------------------------------------------------
router.get(
  "/tenants/:tenantId/reports/conversations",
  requireAuth,
  requireTenantAdmin,
  async (req, res): Promise<void> => {
    const f = parseFilters(req as never);
    const limit = Math.min(2000, Math.max(1, Number(req.query["limit"]) || 200));

    const result = await db.execute(sql`
      ${timingCte(convWhere(f))}
      SELECT
        conv.id, conv.status, conv.created_at, conv.closed_at,
        conv.assigned_to, conv.first_response_secs, conv.resolution_secs,
        d.name AS department_name,
        ct.name AS contact_name, ct.phone AS contact_phone
      FROM conv
      LEFT JOIN departments d ON d.id = conv.department_id
      JOIN contacts ct ON ct.id = (SELECT contact_id FROM conversations WHERE id = conv.id)
      ORDER BY conv.created_at DESC
      LIMIT ${limit}
    `);

    const rows = result.rows.map((r) => ({
      id: r["id"],
      status: r["status"],
      createdAt: r["created_at"],
      closedAt: r["closed_at"],
      assignedTo: r["assigned_to"],
      departmentName: r["department_name"],
      contactName: r["contact_name"],
      contactPhone: r["contact_phone"],
      firstResponseSecs:
        r["first_response_secs"] != null && Number(r["first_response_secs"]) >= 0
          ? Math.round(Number(r["first_response_secs"]))
          : null,
      resolutionSecs:
        r["resolution_secs"] != null ? Math.round(Number(r["resolution_secs"])) : null,
    }));

    if (req.query["format"] === "csv") {
      const esc = (v: unknown) => {
        if (v == null) return "";
        const s = String(v);
        const safe = /^[\s]*[=+\-@\t\r]/.test(s) ? `'${s}` : s;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const header =
        "id,status,contato,telefone,setor,agente,criada_em,fechada_em,primeira_resposta_segundos,resolucao_segundos";
      const lines = rows.map((r) =>
        [
          r.id,
          esc(r.status),
          esc(r.contactName),
          esc(r.contactPhone),
          esc(r.departmentName),
          esc(r.assignedTo),
          esc(r.createdAt),
          esc(r.closedAt),
          r.firstResponseSecs ?? "",
          r.resolutionSecs ?? "",
        ].join(","),
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=relatorio-atendimento.csv",
      );
      res.send([header, ...lines].join("\n"));
      return;
    }
    res.json(rows);
  },
);

export default router;
