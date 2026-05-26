import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

export const runtime = "nodejs";

const schema = z.object({
  epcs: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * POST /api/pos/items/by-epc-lookup-for-status
 *
 * Read-only batch lookup for the Update Status modal on the Inventory tab.
 *
 * Different from /api/pos/items/by-epc:
 *   - Returns ALL items regardless of current status (cart needs LIVE-only,
 *     status-change needs every status so the cashier can see what they're
 *     about to flip — e.g. damaged → tag_killed when scrapping inventory).
 *   - No auto-relocation. The cart flow infers "physical reality wins" from
 *     a sale-context scan; the inventory-status flow is the operator
 *     deliberately editing the catalog and shouldn't silently move items
 *     between stores as a side effect. Cross-location EPCs surface here
 *     with their REAL `current_location_id` so the UI can decide what to
 *     show.
 *   - No `blocked` / `dropped` categorization. Caller (UpdateStatusModal)
 *     decides which rows to apply against; the server just returns facts.
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
  // items.epc is canonicalized upper-case; SSE stream emits lowercase.
  const normalized = parsed.data.epcs.map((e) => e.toUpperCase());

  const rows = await getPool().query<{
    epc: string;
    item_status: string;
    item_location_id: string | null;
    sku: string | null;
    upc: string | null;
    item_name: string | null;
    color: string | null;
    size: string | null;
    label_name: string | null;
  }>(
    `SELECT i.epc,
            i.status                          AS item_status,
            i.location_id::text               AS item_location_id,
            cs.sku,
            COALESCE(cs.upc, m.upc)           AS upc,
            m.description                     AS item_name,
            cs.color_code                     AS color,
            cs.size,
            sl.name                           AS label_name
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
    [normalized],
  );

  const found = rows.rows.map((r) => ({
    epc: r.epc,
    sku: r.sku,
    upc: r.upc,
    item_name: r.item_name,
    color: r.color,
    size: r.size,
    current_status: r.item_status,           // wms canonical value, e.g. 'in-stock'
    current_status_label: r.label_name,      // UI-friendly, e.g. 'LIVE'
    is_at_this_location: r.item_location_id === cashier.lid,
  }));

  return NextResponse.json({
    items: found,
    unknown_count: normalized.length - found.length,
  });
}
