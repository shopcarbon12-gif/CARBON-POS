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
 * Resolve a batch of RFID EPCs to their POS cart rows. ONLY items with
 * status='in-stock' (LIVE) become usable. Everything else is dropped
 * or blocked:
 *
 *   LIVE                              → `items` (usable)
 *   DAMAGED / SOLD                    → `blocked` (needs supervisor)
 *   RETURN / IN TRANSIT /
 *   PENDING TRANSACTION /
 *   STOLEN / TAG KILLED /
 *   PENDING VISIBILITY / UNKNOWN      → `dropped_count` (silent)
 *   EPC not in items table            → `unknown_count`
 *
 * No writes to items.status here — that happens at checkout only.
 * The capture route flips in-cart items to 'sold'.
 *
 * The EPC formula filter happens upstream in WMS ingest — anything
 * that lands in `items` already passed tenant_epc_config validation.
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

  // items.epc is stored uppercase (the WMS catalog canonical form),
  // but the SSE stream emits the hex lowercase. Normalize once on the
  // way in so the indexed equality lookup hits — without this, every
  // scanned tag falls into "unknown" and the cashier sees 0 ready.
  const normalizedEpcs = parsed.data.epcs.map((e) => e.toUpperCase());

  const pool = getPool();
  // CASE maps items.status → status_labels.name (mirrors WMS's
  // labelNameForWmsStatus(); anything not enumerated falls to TAG
  // KILLED, which has is_visible_to_scanner=false so it drops).
  const rows = await pool.query<{
    epc: string;
    item_status: string;
    sku_id: string | null;
    sku: string | null;
    upc: string | null;
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
            i.status                       AS item_status,
            i.custom_sku_id                AS sku_id,
            cs.sku,
            COALESCE(cs.upc, m.upc)        AS upc,
            m.description                  AS item_name,
            cs.color_code                  AS color,
            cs.size,
            cs.retail_price,
            sl.name                        AS label_name,
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
    [normalizedEpcs],
  );

  type UsableItem = {
    epc: string;
    sku_id: string;
    sku: string | null;
    upc: string | null;
    item_name: string | null;
    color: string | null;
    size: string | null;
    retail_price: string | null;
  };
  const usable: UsableItem[] = [];
  const blocked: Array<{ epc: string; status: string }> = [];
  let droppedCount = 0;

  for (const r of rows.rows) {
    if (!r.sku_id) {
      droppedCount++;
      continue;
    }
    // ONLY LIVE (items.status='in-stock' → status_labels 'LIVE',
    // is_sellable=true) makes the cart. Workflow statuses
    // (RETURN / IN TRANSIT / PENDING TRANSACTION) are not sellable
    // until WMS flips them; POS doesn't auto-promote.
    if (r.label_name === "LIVE" && r.is_sellable === true) {
      usable.push({
        epc: r.epc,
        sku_id: r.sku_id,
        sku: r.sku,
        upc: r.upc,
        item_name: r.item_name,
        color: r.color,
        size: r.size,
        retail_price: r.retail_price,
      });
      continue;
    }
    // DAMAGED / SOLD: visible-to-scanner but not sellable AND locked.
    // Show in the blocked panel so cashier can flag it to a supervisor.
    if (r.super_admin_locked === true && r.is_visible_to_scanner !== false) {
      blocked.push({ epc: r.epc, status: r.label_name ?? r.item_status });
      continue;
    }
    // Everything else (RETURN / IN TRANSIT / PENDING TRANSACTION /
    // STOLEN / TAG KILLED / PENDING VISIBILITY / UNKNOWN) → silent drop.
    droppedCount++;
  }

  const foundCount = rows.rows.length;
  const unknownCount = normalizedEpcs.length - foundCount;

  return NextResponse.json({
    items: usable,
    blocked,
    dropped_count: droppedCount,
    unknown_count: unknownCount,
    // Back-compat: existing RFIDScanModal reads `skipped`.
    skipped: blocked.length + droppedCount + unknownCount,
  });
}
