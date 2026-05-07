import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/items/search?q=...
 * Fuzzy product search across WMS catalog (custom_skus joined with matrices).
 * Used by the sell-screen item search box. Returns up to 25 rows ordered
 * with exact UPC/SKU matches first so a barcode scan resolves instantly.
 *
 * Schema notes: custom_skus carries the variant attributes (sku, color_code,
 * size, retail_price, upc); the human-readable product name lives on the
 * parent `matrices.description`. Older copies of this route selected
 * cs.item_name and cs.color (which don't exist) and threw at runtime.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 1) {
    return NextResponse.json({ items: [] });
  }
  const pool = getPool();
  const result = await pool.query(
    `SELECT cs.id,
            cs.sku,
            COALESCE(cs.upc, m.upc) AS upc,
            m.description           AS item_name,
            cs.color_code           AS color,
            cs.size,
            cs.retail_price
       FROM custom_skus cs
       JOIN matrices m ON m.id = cs.matrix_id
      WHERE COALESCE(cs.archived, FALSE) = FALSE
        AND (
          cs.upc = $1
          OR cs.sku = $1
          OR m.description ILIKE $2
        )
      ORDER BY CASE
                 WHEN cs.upc = $1 THEN 0
                 WHEN cs.sku = $1 THEN 1
                 ELSE 2
               END,
               m.description
      LIMIT 25`,
    [q, `%${q}%`],
  );
  return NextResponse.json({ items: result.rows });
}
