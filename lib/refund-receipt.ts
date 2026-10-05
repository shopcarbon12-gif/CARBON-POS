import { getPool } from "@/lib/db";
import { cardDetails } from "@/lib/receipt-pdf";
import type { RefundReceiptData } from "@/components/pos/RefundReceiptView";

/**
 * Everything the refund receipt needs: the refund, the original sale's
 * header, the returned lines (or all lines for refunds made before line
 * tracking), store info and — for card refunds — the card brand/last 4.
 * Null when the refund isn't at the cashier's store (`lid`).
 */
export async function loadRefundReceipt(
  refundId: number,
  lid: string,
): Promise<RefundReceiptData | null> {
  const pool = getPool();
  const r = await pool.query(
    `SELECT rf.id, rf.amount, rf.tax_amount, rf.method, rf.reason, rf.created_at,
            rf.line_ids, rf.original_sale_id,
            s.sale_number, s.completed_at AS sale_at, s.total_amount AS sale_total,
            s.customer_id,
            l.name AS location_name,
            pl.address_line1, pl.address_line2, pl.city, pl.state, pl.zip, pl.phone,
            COALESCE(pl.timezone, 'America/New_York') AS timezone,
            COALESCE(rr.name, r0.name) AS register_name,
            u.first_name AS by_first, u.last_name AS by_last, u.email AS by_email,
            c.first_name AS c_first, c.last_name AS c_last,
            c.store_credit_balance AS c_credit,
            (SELECT COALESCE(SUM(amount),0) FROM pos_refunds
              WHERE original_sale_id = s.id) AS total_refunded,
            (SELECT p.stripe_payment_intent_id FROM pos_payments p
              WHERE p.sale_id = s.id AND p.method = 'card'
              ORDER BY p.id DESC LIMIT 1) AS card_intent
       FROM pos_refunds rf
       JOIN pos_sales s           ON s.id = rf.original_sale_id
       JOIN pos_locations pl      ON pl.id = s.pos_location_id
       JOIN locations l           ON l.id = pl.wms_location_id
       JOIN pos_registers r0      ON r0.id = s.register_id
       LEFT JOIN pos_register_sessions rs ON rs.id = rf.register_session_id
       LEFT JOIN pos_registers rr ON rr.id = rs.register_id
       LEFT JOIN pos_employees pe ON pe.id = rf.refunded_by
       LEFT JOIN users u          ON u.id = pe.user_id
       LEFT JOIN pos_customers c  ON c.id = s.customer_id
      WHERE rf.id = $1 AND pl.wms_location_id = $2::uuid`,
    [refundId, lid],
  );
  const rf = r.rows[0];
  if (!rf) return null;

  const ids: number[] | null = rf.line_ids && rf.line_ids.length ? rf.line_ids : null;
  const linesR = await pool.query(
    `SELECT sl.id, sl.description, sl.quantity, sl.unit_price, sl.discount_amount,
            sl.tax_amount, sl.line_total, sl.line_type,
            cs.sku, cs.color_code, cs.size, m.description AS product
       FROM pos_sale_lines sl
       LEFT JOIN custom_skus cs ON cs.id = sl.sku_id
       LEFT JOIN matrices m     ON m.id = cs.matrix_id
      WHERE sl.sale_id = $1
        AND ($2::int[] IS NULL OR sl.id = ANY($2::int[]))
        AND sl.line_type <> 'loyalty_redemption'
      ORDER BY sl.id`,
    [rf.original_sale_id, ids],
  );

  const card = rf.method === "original_card" ? await cardDetails(rf.card_intent) : null;

  return {
    refund: {
      id: rf.id,
      number: `R${String(rf.id).padStart(6, "0")}`,
      amount: Number(rf.amount),
      tax: rf.tax_amount != null ? Number(rf.tax_amount) : null,
      method: rf.method,
      method_label:
        rf.method === "original_card"
          ? card ?? "Original card"
          : rf.method === "cash"
            ? "Cash"
            : rf.method === "exchange"
              ? "Exchange credit (new sale)"
              : "Store credit",
      reason: rf.reason,
      at: new Date(rf.created_at).toISOString(),
      register: rf.register_name,
      by: [rf.by_first, rf.by_last].filter(Boolean).join(" ") || rf.by_email || "",
      items_known: ids !== null,
    },
    sale: {
      id: rf.original_sale_id,
      number: rf.sale_number,
      at: rf.sale_at ? new Date(rf.sale_at).toISOString() : null,
      total: Number(rf.sale_total),
      total_refunded: Number(rf.total_refunded),
    },
    customer:
      rf.customer_id != null
        ? {
            name: [rf.c_first, rf.c_last].filter(Boolean).join(" ") || null,
            store_credit: rf.c_credit != null ? Number(rf.c_credit) : null,
          }
        : null,
    store: {
      name: rf.location_name,
      address_line1: rf.address_line1,
      address_line2: rf.address_line2,
      city: rf.city,
      state: rf.state,
      zip: rf.zip,
      phone: rf.phone,
      timezone: rf.timezone,
    },
    lines: linesR.rows.map((l) => ({
      id: l.id,
      title: l.product ?? l.description,
      detail: [l.sku ? `SKU ${l.sku}` : null, [l.color_code, l.size].filter(Boolean).join(" / ") || null]
        .filter(Boolean)
        .join(" · "),
      qty: Number(l.quantity),
      amount: Number(l.line_total),
    })),
  };
}
