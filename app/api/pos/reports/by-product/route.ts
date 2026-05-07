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
 * GET /api/pos/reports/by-product?from&to&format
 * Quantity & revenue per SKU sold in the window. Joins to custom_skus to
 * get a stable item name; falls back to the line description if the SKU
 * was deleted later.
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
    `SELECT sl.sku_id,
            COALESCE(m.description, sl.description) AS item_name,
            cs.color_code AS color, cs.size, cs.sku,
            SUM(sl.quantity)::int                   AS qty,
            COALESCE(SUM(sl.line_total), 0)         AS revenue
       FROM pos_sale_lines sl
       JOIN pos_sales s         ON s.id = sl.sale_id
       LEFT JOIN custom_skus cs ON cs.id = sl.sku_id
       LEFT JOIN matrices m     ON m.id = cs.matrix_id
      WHERE s.status = 'completed'
        AND s.completed_at::date BETWEEN $1 AND $2
      GROUP BY sl.sku_id, item_name, cs.color_code, cs.size, cs.sku
      ORDER BY revenue DESC
      LIMIT 500`,
    [from, to],
  );
  if (format === "csv") {
    const csv = toCsv([
      ["sku", "item", "color", "size", "qty", "revenue"],
      ...rows.rows.map((r) => [
        r.sku ?? "",
        r.item_name ?? "",
        r.color ?? "",
        r.size ?? "",
        r.qty,
        Number(r.revenue).toFixed(2),
      ]),
    ]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="by-product-${from}-to-${to}.csv"`,
      },
    });
  }
  return NextResponse.json({ rows: rows.rows });
}
