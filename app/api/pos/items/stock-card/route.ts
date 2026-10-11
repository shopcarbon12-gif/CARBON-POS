import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/items/stock-card?sku=<custom_skus.id>&epc=<tag>
 *
 * Everything the order screen's item popup shows: the product, stock here
 * / in transit / at other stores, every size & color of the style with its
 * stock, and — when the line was an RFID piece — where that exact tag is
 * now plus its history (sold, returned, status changes).
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const sku = url.searchParams.get("sku");
  const epc = url.searchParams.get("epc")?.toUpperCase() || null;
  if (sku && !/^[0-9a-f-]{36}$/i.test(sku)) {
    return NextResponse.json({ error: "invalid_sku" }, { status: 400 });
  }
  const pool = getPool();
  const lid = cashier.lid;

  // Resolve the SKU from the tag when the line didn't carry one.
  let skuId = sku;
  if (!skuId && epc) {
    const r = await pool.query<{ id: string | null }>(
      `SELECT custom_sku_id::text AS id FROM items WHERE upper(epc) = $1 LIMIT 1`,
      [epc],
    );
    skuId = r.rows[0]?.id ?? null;
  }

  // Sequential on one pool is fine; each query is small and indexed.
  const product = skuId
    ? (
        await pool.query<{
          sku: string;
          upc: string | null;
          item_name: string;
          brand: string | null;
          vendor: string | null;
          category: string | null;
          color: string | null;
          size: string | null;
          retail_price: string | null;
          image_url: string | null;
          is_manual_only: boolean;
        }>(
          `SELECT cs.sku,
                  COALESCE(cs.shopify_image_url, m.shopify_featured_image_url) AS image_url,
                  COALESCE(cs.upc, m.upc) AS upc,
                  m.description AS item_name, m.brand, m.vendor, m.category,
                  cs.color_code AS color, cs.size, cs.retail_price::text,
                  COALESCE(m.is_manual_only, FALSE) AS is_manual_only
             FROM custom_skus cs
             JOIN matrices m ON m.id = cs.matrix_id
            WHERE cs.id = $1::uuid`,
          [skuId],
        )
      ).rows[0] ?? null
    : null;

  const variants = skuId
    ? (
        await pool.query<{
          id: string;
          sku: string;
          color: string | null;
          size: string | null;
          retail_price: string | null;
          here: number;
          elsewhere: number;
        }>(
          `SELECT v.id::text, v.sku, v.color_code AS color, v.size, v.retail_price::text,
                  (COALESCE(stk.here, 0) + COALESCE(mq.here, 0))::int AS here,
                  (COALESCE(stk.elsewhere, 0) + COALESCE(mq.elsewhere, 0))::int AS elsewhere
             FROM custom_skus src
             JOIN custom_skus v ON v.matrix_id = src.matrix_id AND COALESCE(v.archived, FALSE) = FALSE
             LEFT JOIN LATERAL (
               SELECT count(*) FILTER (WHERE i.location_id = $2::uuid)  AS here,
                      count(*) FILTER (WHERE i.location_id <> $2::uuid) AS elsewhere
                 FROM items i
                WHERE i.custom_sku_id = v.id AND i.status = 'in-stock'
             ) stk ON TRUE
             LEFT JOIN LATERAL (
               SELECT sum(q.current_qty) FILTER (WHERE q.location_id = $2::uuid)  AS here,
                      sum(q.current_qty) FILTER (WHERE q.location_id <> $2::uuid) AS elsewhere
                 FROM manual_item_qty q WHERE q.custom_sku_id = v.id
             ) mq ON TRUE
            WHERE src.id = $1::uuid
            ORDER BY v.sort_order NULLS LAST, v.color_code, v.size`,
          [skuId, lid],
        )
      ).rows
    : [];

  const byLocation = skuId
    ? (
        await pool.query<{ location_name: string; n: number; is_here: boolean }>(
          `SELECT l.name AS location_name, sum(x.n)::int AS n, bool_or(x.location_id = $2::uuid) AS is_here
             FROM (
               SELECT location_id, count(*) AS n FROM items
                WHERE custom_sku_id = $1::uuid AND status = 'in-stock'
                GROUP BY location_id
               UNION ALL
               SELECT location_id, current_qty FROM manual_item_qty
                WHERE custom_sku_id = $1::uuid AND current_qty > 0
             ) x
             JOIN locations l ON l.id = x.location_id
            GROUP BY l.name
            ORDER BY bool_or(x.location_id = $2::uuid) DESC, sum(x.n) DESC, l.name`,
          [skuId, lid],
        )
      ).rows
    : [];

  let inTransit = 0;
  if (skuId) {
    const t = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c
         FROM items i
         JOIN transfer_records tr ON tr.id = i.transfer_id
        WHERE i.custom_sku_id = $1::uuid
          AND tr.destination_location_id = $2::uuid
          AND tr.state IN ('in-transit','partially_received')`,
      [skuId, lid],
    );
    inTransit = Number(t.rows[0]?.c ?? 0);
  }

  // The exact tag on this line: where it is now + what happened to it.
  let tag: null | {
    epc: string;
    status: string;
    location_name: string | null;
    is_here: boolean;
    bin: string | null;
    last_seen_at: string | null;
    history: Array<{ at: string; event: string; detail: string | null; sale_id?: number; refund_id?: number }>;
  } = null;
  if (epc) {
    const t = await pool.query<{
      epc: string;
      status: string;
      location_name: string | null;
      is_here: boolean;
      bin: string | null;
      last_seen_at: string | null;
    }>(
      `SELECT i.epc, i.status, l.name AS location_name,
              (i.location_id = $2::uuid) AS is_here,
              b.code AS bin, i.last_seen_at
         FROM items i
         LEFT JOIN locations l ON l.id = i.location_id
         LEFT JOIN bins b      ON b.id = i.bin_id
        WHERE upper(i.epc) = $1
        LIMIT 1`,
      [epc, lid],
    );
    const sold = await pool.query<{ at: string; sale_id: number; sale_number: string }>(
      `SELECT COALESCE(s.completed_at, s.created_at) AS at, s.id AS sale_id, s.sale_number
         FROM pos_sale_lines sl
         JOIN pos_sales s ON s.id = sl.sale_id
        WHERE (upper(sl.epc) = $1 OR $1 = ANY(sl.epcs))
          AND s.status <> 'open'`,
      [epc],
    );
    const returned = await pool.query<{ at: string; refund_id: number; sale_number: string; exchange: boolean }>(
      `SELECT ri.created_at AS at, rf.id AS refund_id, s.sale_number,
              (rf.exchange_sale_id IS NOT NULL) AS exchange
         FROM pos_refund_items ri
         JOIN pos_refunds rf ON rf.id = ri.refund_id
         JOIN pos_sales s    ON s.id = rf.original_sale_id
        WHERE upper(ri.epc) = $1`,
      [epc],
    );
    // POS sales/returns already appear from the POS tables above.
    const audit = await pool.query<{ at: string; log_type: string; old_value: string | null; new_value: string | null; reason: string | null; who: string | null }>(
      `SELECT a.created_at AS at, a.log_type, a.old_value, a.new_value, a.reason,
              NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS who
         FROM inventory_audit_logs a
         LEFT JOIN users u ON u.id = a.user_uuid
        WHERE a.entity_type = 'EPC' AND upper(a.entity_reference) = $1
          AND COALESCE(a.reason, '') NOT IN ('pos_sale', 'pos_refund', 'pos_exchange')
        ORDER BY a.created_at DESC
        LIMIT 25`,
      [epc],
    );
    const history = [
      ...sold.rows.map((r) => ({
        at: r.at,
        event: "Sold",
        detail: `Receipt #${r.sale_number}`,
        sale_id: r.sale_id,
      })),
      ...returned.rows.map((r) => ({
        at: r.at,
        event: r.exchange ? "Returned (exchange)" : "Returned (refund)",
        detail: `From receipt #${r.sale_number}`,
        refund_id: r.refund_id,
      })),
      ...audit.rows.map((r) => ({
        at: r.at,
        event:
          r.log_type === "STATUS_CHANGE"
            ? `Status: ${r.old_value ?? "?"} → ${r.new_value ?? "?"}`
            : r.old_value || r.new_value
              ? `Bin: ${r.old_value || "—"} → ${r.new_value || "none"}`
              : "Inventory update",
        detail: [r.reason?.replace(/_/g, " "), r.who].filter(Boolean).join(" · ") || null,
      })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const row = t.rows[0];
    tag = row
      ? { ...row, history }
      : { epc, status: "unknown", location_name: null, is_here: false, bin: null, last_seen_at: null, history };
  }

  const here = byLocation.filter((r) => r.is_here).reduce((a, r) => a + r.n, 0);
  const elsewhere = byLocation.filter((r) => !r.is_here).reduce((a, r) => a + r.n, 0);
  return NextResponse.json({
    sku_id: skuId,
    product,
    in_stock: here,
    in_transit: inTransit,
    elsewhere,
    by_location: byLocation,
    variants,
    tag,
    can_manage: cashier.role === "manager" || cashier.role === "admin",
  });
}
