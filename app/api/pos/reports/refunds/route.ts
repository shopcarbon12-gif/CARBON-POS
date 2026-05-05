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

/** GET /api/pos/reports/refunds?from&to — refunds + voids combined. */
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
  const refunds = await pool.query(
    `SELECT r.created_at,
            s.sale_number,
            r.amount,
            r.method,
            r.reason,
            uo.email AS refunded_by_email
       FROM pos_refunds r
       JOIN pos_sales s      ON s.id = r.original_sale_id
       JOIN pos_employees pe ON pe.id = r.refunded_by
       JOIN users uo         ON uo.id = pe.user_id
      WHERE r.created_at::date BETWEEN $1 AND $2
      ORDER BY r.created_at DESC`,
    [from, to],
  );
  const voids = await pool.query(
    `SELECT s.voided_at  AS created_at,
            s.sale_number,
            s.total_amount AS amount,
            'void'        AS method,
            s.void_reason AS reason,
            u.email       AS refunded_by_email
       FROM pos_sales s
       LEFT JOIN pos_employees pe ON pe.id = s.voided_by
       LEFT JOIN users u          ON u.id = pe.user_id
      WHERE s.status = 'voided'
        AND s.voided_at::date BETWEEN $1 AND $2
      ORDER BY s.voided_at DESC`,
    [from, to],
  );
  const all = [...refunds.rows, ...voids.rows].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  if (format === "csv") {
    const csv = toCsv([
      ["when", "sale_number", "amount", "method", "reason", "by"],
      ...all.map((r) => [
        new Date(r.created_at).toISOString(),
        r.sale_number,
        Number(r.amount).toFixed(2),
        r.method,
        r.reason ?? "",
        r.refunded_by_email ?? "",
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="refunds-${from}-to-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ rows: all });
}
