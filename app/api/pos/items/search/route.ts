import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/items/search?q=...
 * Catalog search used by the sell screen. Pulls from the same custom_skus
 * + matrices catalog the Inventory tab shows, scoped to the active
 * location's in-stock count for the badge in the dropdown.
 *
 * Matching: partial (ILIKE %q%) across SKU, UPC (variant + matrix),
 * description, color, size, brand, vendor, and category. Exact UPC / SKU
 * matches still rank first so a barcode scan resolves instantly to one
 * row. Results capped at 25.
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
  const like = `%${q}%`;
  const pool = getPool();
  const result = await pool.query(
    `SELECT cs.id::text,
            cs.sku,
            COALESCE(cs.upc, m.upc)            AS upc,
            m.description                      AS item_name,
            cs.color_code                      AS color,
            cs.size,
            cs.retail_price::text,
            COALESCE(m.is_manual_only, FALSE)  AS is_manual_only,
            COALESCE(stk.n, 0)::int            AS stock_count
       FROM custom_skus cs
       JOIN matrices m ON m.id = cs.matrix_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n
           FROM items i
          WHERE i.custom_sku_id = cs.id
            AND i.location_id   = $3::uuid
            AND i.status        = 'in-stock'
       ) stk ON TRUE
      WHERE COALESCE(cs.archived, FALSE) = FALSE
        AND (
          cs.sku        ILIKE $2
          OR cs.upc     ILIKE $2
          OR m.upc      ILIKE $2
          OR m.description ILIKE $2
          OR cs.color_code ILIKE $2
          OR cs.size       ILIKE $2
          OR m.brand       ILIKE $2
          OR m.vendor      ILIKE $2
          OR m.category    ILIKE $2
        )
      ORDER BY CASE
                 WHEN cs.upc = $1 THEN 0
                 WHEN cs.sku = $1 THEN 1
                 WHEN m.upc  = $1 THEN 2
                 WHEN cs.sku ILIKE ($1 || '%') THEN 3
                 WHEN m.description ILIKE ($1 || '%') THEN 4
                 ELSE 9
               END,
               m.description ASC,
               cs.sku ASC
      LIMIT 25`,
    [q, like, cashier.lid],
  );
  return NextResponse.json({ items: result.rows });
}
