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
 * GET /api/pos/reports/discounts?from&to&format
 * Every line that had a non-zero discount applied in the window. Useful
 * for spotting heavy comp / promotion patterns by cashier.
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
    `SELECT s.completed_at,
            s.sale_number,
            u.email AS cashier_email,
            sl.description,
            sl.unit_price,
            sl.quantity,
            sl.discount_amount,
            sl.line_total
       FROM pos_sale_lines sl
       JOIN pos_sales s      ON s.id = sl.sale_id
       JOIN pos_employees pe ON pe.id = s.cashier_id
       JOIN users u          ON u.id = pe.user_id
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
        AND sl.discount_amount > 0
      ORDER BY s.completed_at DESC
      LIMIT 1000`,
    [from, to],
  );
  if (format === "csv") {
    const csv = toCsv([
      [
        "completed_at",
        "sale_number",
        "cashier",
        "item",
        "qty",
        "unit_price",
        "discount",
        "line_total",
      ],
      ...rows.rows.map((r) => [
        new Date(r.completed_at).toISOString(),
        r.sale_number,
        r.cashier_email,
        r.description,
        r.quantity,
        Number(r.unit_price).toFixed(2),
        Number(r.discount_amount).toFixed(2),
        Number(r.line_total).toFixed(2),
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="discounts-${from}-to-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ rows: rows.rows });
}
