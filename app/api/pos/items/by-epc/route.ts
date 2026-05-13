import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  epcs: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * POST /api/pos/items/by-epc
 *
 * Resolve a batch of RFID EPCs to their POS cart rows, classifying each
 * by the 10-status policy from `status_labels`. NO writes to items.status
 * happen here — the rule is "status changes only at checkout" (capture
 * route flips in-cart items to 'sold' inside the sale transaction).
 *
 *   LIVE (is_sellable=true)
 *     → usable; included in `items`.
 *
 *   RETURN / IN TRANSIT / PENDING TRANSACTION
 *     (is_sellable=false, is_visible_to_scanner=true,
 *      super_admin_locked=false)
 *     → treated as sellable for the cart (the capture route will flip
 *       directly to 'sold' on checkout, which supersedes any workflow
 *       status). Counted in `promote_count` so the cashier can be told
 *       "3 tags promoted at checkout".
 *
 *   DAMAGED / SOLD
 *     (super_admin_locked=true, is_visible_to_scanner=true)
 *     → returned in `blocked`; sell screen surfaces a "needs supervisor"
 *       prompt. NOT added to cart.
 *
 *   STOLEN / TAG KILLED / PENDING VISIBILITY / UNKNOWN
 *     (is_visible_to_scanner=false)
 *     → silently dropped. Counted in `dropped_count` for telemetry.
 *
 *   EPC not in items table → counted in `unknown_count`.
 *
 * The EPC formula filter happens upstream in WMS ingest — anything that
 * lands in `items` already passed tenant_epc_config validation.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const pool = getPool();
  // CASE maps items.status → status_labels.name (mirrors WMS's
  // labelNameForWmsStatus(); anything not enumerated falls to TAG
  // KILLED, which has is_visible_to_scanner=false so it drops).
  const rows = await pool.query<{
    epc: string;
    item_status: string;
    sku_id: string | null;
    sku: string | null;
    item_name: string | null;
    color: string | null;
    size: string | null;
    retail_price: string | null;
    label_name: string | null;
    is_sellable: boolean | null;
    is_visible_to_scanner: boolean | null;
    super_admin_locked: boolean | null;
  }>(
    `SELECT i.epc,
            i.status                  AS item_status,
            i.custom_sku_id           AS sku_id,
            cs.sku,
            m.description             AS item_name,
            cs.color_code             AS color,
            cs.size,
            cs.retail_price,
            sl.name                   AS label_name,
            sl.is_sellable,
            sl.is_visible_to_scanner,
            sl.super_admin_locked
       FROM items i
       LEFT JOIN custom_skus cs ON cs.id = i.custom_sku_id
       LEFT JOIN matrices    m  ON m.id  = cs.matrix_id
       LEFT JOIN status_labels sl
              ON sl.name = CASE i.status
                   WHEN 'in-stock'            THEN 'LIVE'
                   WHEN 'return'              THEN 'RETURN'
                   WHEN 'damaged'             THEN 'DAMAGED'
                   WHEN 'sold'                THEN 'SOLD'
                   WHEN 'stolen'              THEN 'STOLEN'
                   WHEN 'tag_killed'          THEN 'TAG KILLED'
                   WHEN 'pending_visibility'  THEN 'PENDING VISIBILITY'
                   WHEN 'in-transit'          THEN 'IN TRANSIT'
                   WHEN 'pending_transaction' THEN 'PENDING TRANSACTION'
                   ELSE 'TAG KILLED'
                 END
      WHERE i.epc = ANY($1::text[])`,
    [parsed.data.epcs],
  );

  type UsableItem = {
    epc: string;
    sku_id: string;
    sku: string | null;
    item_name: string | null;
    color: string | null;
    size: string | null;
    retail_price: string | null;
  };
  const usable: UsableItem[] = [];
  const blocked: Array<{ epc: string; status: string }> = [];
  let promoteCount = 0;
  let droppedCount = 0;

  for (const r of rows.rows) {
    if (!r.sku_id) {
      droppedCount++;
      continue;
    }
    if (r.is_visible_to_scanner === false) {
      droppedCount++;
      continue;
    }
    const row: UsableItem = {
      epc: r.epc,
      sku_id: r.sku_id,
      sku: r.sku,
      item_name: r.item_name,
      color: r.color,
      size: r.size,
      retail_price: r.retail_price,
    };
    if (r.is_sellable === true) {
      usable.push(row);
      continue;
    }
    if (r.super_admin_locked === true) {
      blocked.push({ epc: r.epc, status: r.label_name ?? r.item_status });
      continue;
    }
    // Not sellable, not locked, visible — accept into the cart. The
    // capture route will flip the status to 'sold' at checkout, which
    // legitimises the implicit RETURN/IN_TRANSIT/PENDING_TRANSACTION →
    // sold promotion atomically with the sale.
    promoteCount++;
    usable.push(row);
  }

  const foundCount = rows.rows.length;
  const unknownCount = parsed.data.epcs.length - foundCount;

  return NextResponse.json({
    items: usable,
    blocked,
    promote_count: promoteCount,
    dropped_count: droppedCount,
    unknown_count: unknownCount,
    // Back-compat: existing RFIDScanModal reads `skipped`.
    skipped: blocked.length + droppedCount + unknownCount,
  });
}
