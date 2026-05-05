import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/sales?q=...
 * Search past completed sales by sale_number or customer name. Used by the
 * /pos/refund flow and the back-office sales-history view.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length === 0) {
    return NextResponse.json({ sales: [] });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.id,
            s.sale_number,
            s.total_amount,
            s.completed_at,
            c.first_name AS customer_first_name,
            c.last_name  AS customer_last_name
       FROM pos_sales s
       LEFT JOIN pos_customers c ON c.id = s.customer_id
      WHERE s.status IN ('completed','refunded')
        AND (
          s.sale_number ILIKE $1
          OR c.first_name ILIKE $1
          OR c.last_name  ILIKE $1
        )
      ORDER BY s.completed_at DESC NULLS LAST
      LIMIT 25`,
    [`%${q}%`],
  );
  return NextResponse.json({ sales: r.rows });
}
