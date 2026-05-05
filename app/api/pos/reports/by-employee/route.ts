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

/** GET /api/pos/reports/by-employee?from&to&format — sales per cashier. */
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
    `SELECT s.cashier_id,
            u.email                              AS cashier_email,
            COUNT(*)                              AS tx_count,
            COALESCE(SUM(s.total_amount), 0)     AS revenue,
            COALESCE(SUM(s.tax_amount), 0)       AS tax,
            COALESCE(SUM(s.discount_amount), 0)  AS discount
       FROM pos_sales s
       JOIN pos_employees pe ON pe.id = s.cashier_id
       JOIN users u          ON u.id = pe.user_id
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
      GROUP BY s.cashier_id, u.email
      ORDER BY revenue DESC`,
    [from, to],
  );
  if (format === "csv") {
    const csv = toCsv([
      ["cashier", "tx_count", "revenue", "tax", "discount"],
      ...rows.rows.map((r) => [
        r.cashier_email,
        r.tx_count,
        Number(r.revenue).toFixed(2),
        Number(r.tax).toFixed(2),
        Number(r.discount).toFixed(2),
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="by-employee-${from}-to-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ rows: rows.rows });
}
