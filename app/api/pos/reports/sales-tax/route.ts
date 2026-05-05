import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { toCsv } from "@/lib/csv";

const schema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pos_location_id: z.coerce.number().int().positive().optional(),
  format: z.enum(["json", "csv"]).optional(),
});

/**
 * GET /api/pos/reports/sales-tax?from=YYYY-MM-DD&to=YYYY-MM-DD&pos_location_id=…&format=csv
 *
 * Day-by-day sales-tax breakdown. Returns JSON by default; ?format=csv
 * streams an RFC 4180 CSV ready for the accountant.
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
  const { from, to, pos_location_id, format } = parsed.data;
  const args: unknown[] = [from, to];
  let extra = "";
  if (pos_location_id) {
    args.push(pos_location_id);
    extra = ` AND s.pos_location_id = $${args.length}`;
  }
  const pool = getPool();
  const rows = await pool.query(
    `SELECT s.completed_at::date AS day,
            COUNT(*)                            AS tx_count,
            COALESCE(SUM(s.subtotal),0)         AS subtotal,
            COALESCE(SUM(s.discount_amount),0)  AS discount,
            COALESCE(SUM(s.tax_amount),0)       AS tax,
            COALESCE(SUM(s.total_amount),0)     AS total
       FROM pos_sales s
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
        ${extra}
      GROUP BY day
      ORDER BY day`,
    args,
  );
  if (format === "csv") {
    const csv = toCsv([
      ["day", "tx_count", "subtotal", "discount", "tax", "total"],
      ...rows.rows.map((r) => [
        new Date(r.day).toISOString().slice(0, 10),
        r.tx_count,
        Number(r.subtotal).toFixed(2),
        Number(r.discount).toFixed(2),
        Number(r.tax).toFixed(2),
        Number(r.total).toFixed(2),
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sales-tax-${from}-to-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ rows: rows.rows });
}
