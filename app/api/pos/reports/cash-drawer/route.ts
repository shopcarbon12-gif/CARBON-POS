import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { toCsv } from "@/lib/csv";

const schema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(["json", "csv"]).optional(),
});

/**
 * GET /api/pos/reports/cash-drawer?from&to&format
 * One row per closed register session, plus aggregate cash drops/payouts.
 * Used to reconcile cash-handling at end of day / week.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { from, to, format } = parsed.data;
  const pool = getPool();
  const rows = await pool.query(
    `SELECT s.id,
            r.name                                      AS register_name,
            uo.email                                    AS opened_by_email,
            uc.email                                    AS closed_by_email,
            s.opened_at,
            s.closed_at,
            s.opening_cash,
            s.expected_cash,
            s.closing_cash_counted,
            s.cash_over_short,
            COALESCE((SELECT SUM(amount) FROM pos_cash_movements
                       WHERE register_session_id = s.id AND type = 'drop'), 0)   AS cash_drops,
            COALESCE((SELECT SUM(amount) FROM pos_cash_movements
                       WHERE register_session_id = s.id AND type = 'payout'), 0) AS cash_payouts
       FROM pos_register_sessions s
       JOIN pos_registers r ON r.id = s.register_id
       JOIN users uo        ON uo.id = s.opened_by
       LEFT JOIN users uc   ON uc.id = s.closed_by
      WHERE s.status = 'closed'
        AND s.closed_at::date BETWEEN $1 AND $2
      ORDER BY s.closed_at DESC`,
    [from, to],
  );
  if (format === "csv") {
    const csv = toCsv([
      [
        "register",
        "opened_by",
        "closed_by",
        "opened_at",
        "closed_at",
        "opening_cash",
        "expected_cash",
        "counted",
        "over_short",
        "drops",
        "payouts",
      ],
      ...rows.rows.map((r) => [
        r.register_name,
        r.opened_by_email,
        r.closed_by_email ?? "",
        new Date(r.opened_at).toISOString(),
        r.closed_at ? new Date(r.closed_at).toISOString() : "",
        Number(r.opening_cash).toFixed(2),
        r.expected_cash !== null ? Number(r.expected_cash).toFixed(2) : "",
        r.closing_cash_counted !== null
          ? Number(r.closing_cash_counted).toFixed(2)
          : "",
        r.cash_over_short !== null
          ? Number(r.cash_over_short).toFixed(2)
          : "",
        Number(r.cash_drops).toFixed(2),
        Number(r.cash_payouts).toFixed(2),
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="cash-drawer-${from}-to-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ rows: rows.rows });
}
