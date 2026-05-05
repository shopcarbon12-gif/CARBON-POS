import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  register_id: z.coerce.number().int().positive().optional(),
  pos_location_id: z.coerce.number().int().positive().optional(),
});

/**
 * GET /api/pos/reports/end-of-day?date=YYYY-MM-DD&register_id=...&pos_location_id=...
 * Per-register breakdown + totals for the requested day. Used by the End
 * of Day report on /admin/reports.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (cashier.role !== "manager" && cashier.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);

  const pool = getPool();
  const conditions: string[] = [
    "s.status = 'completed'",
    `s.completed_at::date = $1`,
  ];
  const args: unknown[] = [date];
  if (parsed.data.register_id) {
    args.push(parsed.data.register_id);
    conditions.push(`s.register_id = $${args.length}`);
  }
  if (parsed.data.pos_location_id) {
    args.push(parsed.data.pos_location_id);
    conditions.push(`s.pos_location_id = $${args.length}`);
  }
  const where = conditions.join(" AND ");

  const totals = await pool.query(
    `SELECT
       COUNT(*) AS tx_count,
       COALESCE(SUM(s.subtotal), 0)        AS subtotal,
       COALESCE(SUM(s.discount_amount), 0) AS discount,
       COALESCE(SUM(s.tax_amount), 0)      AS tax,
       COALESCE(SUM(s.total_amount), 0)    AS total
     FROM pos_sales s
     WHERE ${where}`,
    args,
  );
  const byMethod = await pool.query(
    `SELECT p.method,
            COALESCE(SUM(p.amount), 0) AS amount,
            COUNT(*) AS count
       FROM pos_payments p
       JOIN pos_sales s ON s.id = p.sale_id
      WHERE ${where} AND p.status = 'completed'
      GROUP BY p.method
      ORDER BY p.method`,
    args,
  );
  const byRegister = await pool.query(
    `SELECT s.register_id,
            r.name AS register_name,
            COUNT(*) AS tx_count,
            COALESCE(SUM(s.total_amount), 0) AS total
       FROM pos_sales s
       JOIN pos_registers r ON r.id = s.register_id
      WHERE ${where}
      GROUP BY s.register_id, r.name
      ORDER BY r.name`,
    args,
  );
  return NextResponse.json({
    date,
    totals: totals.rows[0],
    by_method: byMethod.rows,
    by_register: byRegister.rows,
  });
}
