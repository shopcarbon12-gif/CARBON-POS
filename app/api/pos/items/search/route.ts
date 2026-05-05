import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/items/search?q=...
 * Fuzzy product search across the WMS custom_skus table by item_name, sku,
 * and upc. Used by the sell-screen item search box. Returns up to 25 rows
 * ordered with exact UPC/SKU matches first (so a barcode scan resolves
 * instantly to one row).
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
    `SELECT id,
            sku,
            upc,
            item_name,
            color,
            size,
            retail_price,
            bin
       FROM custom_skus
      WHERE upc = $1
         OR sku = $1
         OR item_name ILIKE $2
      ORDER BY CASE
                 WHEN upc = $1 THEN 0
                 WHEN sku = $1 THEN 1
                 ELSE 2
               END,
               item_name
      LIMIT 25`,
    [q, `%${q}%`],
  );
  return NextResponse.json({ items: result.rows });
}
