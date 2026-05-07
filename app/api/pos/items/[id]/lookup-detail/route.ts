import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/items/{id}/lookup-detail?locationId=...
 *
 * Stock + in-transit + elsewhere counts for a single SKU at the active
 * location. Used by /sales/{code}/lookup so the floor staff can answer
 * "do we have this?" without touching the sell screen.
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
  // The session's lid is the source of truth — we accept the query param
  // for forward-compat but ignore it when it doesn't match.
  const requested = url.searchParams.get("locationId");
  const locationId = requested && requested === cashier.lid ? requested : cashier.lid;

  const pool = getPool();
  const [hereR, transitR, elseR] = await Promise.all([
    pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM items
        WHERE custom_sku_id = $1::uuid
          AND location_id = $2::uuid
          AND status = 'in-stock'`,
      [id, locationId],
    ),
    pool.query<{ c: string }>(
      // Best-effort "in transit toward this location": transfer-record items
      // headed here and not yet received. We probe to_regclass first since
      // the WMS schema may name the join differently across deployments.
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
    pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM items
        WHERE custom_sku_id = $1::uuid
          AND location_id <> $2::uuid
          AND status = 'in-stock'`,
      [id, locationId],
    ),
  ]);

  return NextResponse.json({
    in_stock: Number(hereR.rows[0]?.c ?? 0),
    in_transit: Number(transitR.rows[0]?.c ?? 0),
    elsewhere: Number(elseR.rows[0]?.c ?? 0),
  });
}
