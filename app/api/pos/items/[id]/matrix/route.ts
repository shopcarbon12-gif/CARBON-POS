import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/items/:id/matrix
 * Every color/size of the product a SKU belongs to, with stock at the
 * cashier's store — for the sell screen's color × size picker. Variants
 * use the same shape as /api/pos/items/search results.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = (await ctx.params).id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const r = await getPool().query(
    `SELECT m.description AS item_name,
            m.shopify_featured_image_url AS matrix_image,
            v.id::text, v.sku, COALESCE(v.upc, m.upc) AS upc,
            v.color_code AS color, v.size, v.retail_price::text,
            COALESCE(m.is_manual_only, FALSE) AS is_manual_only,
            v.shopify_image_url AS image_url,
            COALESCE(stk.n, 0)::int AS stock_count,
            v.sort_order
       FROM custom_skus src
       JOIN matrices m     ON m.id = src.matrix_id
       JOIN custom_skus v  ON v.matrix_id = m.id AND COALESCE(v.archived, FALSE) = FALSE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n FROM items i
          WHERE i.custom_sku_id = v.id AND i.location_id = $2::uuid AND i.status = 'in-stock'
       ) stk ON TRUE
      WHERE src.id = $1::uuid
      ORDER BY v.sort_order NULLS LAST, v.color_code, v.size`,
    [id, cashier.lid],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    item_name: r.rows[0].item_name,
    image_url: r.rows[0].matrix_image ?? null,
    variants: r.rows.map((v) => ({
      id: v.id,
      sku: v.sku,
      upc: v.upc,
      item_name: v.item_name,
      color: v.color,
      size: v.size,
      retail_price: v.retail_price,
      is_manual_only: v.is_manual_only,
      image_url: v.image_url,
      stock_count: v.stock_count,
    })),
  });
}
