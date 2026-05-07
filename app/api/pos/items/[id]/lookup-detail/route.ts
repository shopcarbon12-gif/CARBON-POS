import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/items/{id}/lookup-detail?locationId=...
 *
 * Stock + in-transit + per-location breakdown for a single SKU. Used by
 * /sales/{code}/lookup so the floor staff can answer "do we have this?"
 * without touching the sell screen, including which sister stores have
 * stock on hand.
 *
 * `id` is custom_skus.id (UUID).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const url = new URL(req.url);
  // Source of truth for the active location is the session's lid; the
  // query param is honored only when it matches.
  const requested = url.searchParams.get("locationId");
  const locationId = requested && requested === cashier.lid ? requested : cashier.lid;

  const pool = getPool();
  const [skuR, hereR, transitR, byLocR] = await Promise.all([
    // Richer SKU detail — pulls brand/vendor/category from matrices so the
    // detail card can show more than just sku/upc/color/size.
    pool.query<{
      sku: string;
      upc: string | null;
      item_name: string;
      brand: string | null;
      vendor: string | null;
      category: string | null;
      color: string | null;
      size: string | null;
      retail_price: string | null;
    }>(
      `SELECT cs.sku,
              COALESCE(cs.upc, m.upc) AS upc,
              m.description           AS item_name,
              m.brand                 AS brand,
              m.vendor                AS vendor,
              m.category              AS category,
              cs.color_code           AS color,
              cs.size,
              cs.retail_price::text
         FROM custom_skus cs
         JOIN matrices m ON m.id = cs.matrix_id
        WHERE cs.id = $1::uuid
        LIMIT 1`,
      [id],
    ),
    pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM items
        WHERE custom_sku_id = $1::uuid
          AND location_id = $2::uuid
          AND status = 'in-stock'`,
      [id, locationId],
    ),
    pool.query<{ c: string }>(
      `SELECT
         COALESCE((
           SELECT count(*)::text FROM transfer_records tr
           JOIN transfer_record_items tri ON tri.transfer_record_id = tr.id
           WHERE tri.custom_sku_id = $1::uuid
             AND tr.destination_location_id = $2::uuid
             AND tr.state IN ('in-transit','partially_received')
         ), '0') AS c
       WHERE to_regclass('public.transfer_records') IS NOT NULL
         AND to_regclass('public.transfer_record_items') IS NOT NULL`,
      [id, locationId],
    ),
    // Per-location breakdown for OTHER stores. Cashiers asking "does
    // anyone have this in size M?" want a name, not a count.
    pool.query<{ location_id: string; location_name: string; n: string }>(
      `SELECT i.location_id::text AS location_id,
              l.name              AS location_name,
              count(*)::text      AS n
         FROM items i
         JOIN locations l ON l.id = i.location_id
        WHERE i.custom_sku_id = $1::uuid
          AND i.location_id <> $2::uuid
          AND i.status = 'in-stock'
        GROUP BY i.location_id, l.name
        ORDER BY n::int DESC, l.name ASC`,
      [id, locationId],
    ),
  ]);

  const sku = skuR.rows[0] ?? null;
  const byLocation = byLocR.rows.map((r) => ({
    location_id: r.location_id,
    location_name: r.location_name,
    in_stock: Number(r.n),
  }));
  const elsewhere = byLocation.reduce((s, r) => s + r.in_stock, 0);

  return NextResponse.json({
    sku,
    in_stock: Number(hereR.rows[0]?.c ?? 0),
    in_transit: Number(transitR.rows[0]?.c ?? 0),
    elsewhere,
    by_location: byLocation,
  });
}
