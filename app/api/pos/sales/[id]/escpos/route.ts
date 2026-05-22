import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { buildSaleReceiptPayload } from "@/lib/thermal-printer";
import { currentCashier } from "@/lib/session";
import { computeEarn } from "@/lib/loyalty-earn";

/**
 * GET /api/pos/sales/:id/escpos
 * Returns the receipt as two ESC/POS hex blobs (merchant first, then
 * customer) plus the printer's host/port. The cashier's browser POSTs
 * each blob to the printer's ePOS-Print HTTP endpoint over the LAN —
 * the cloud server isn't on the same network as the printer, so it
 * never opens a TCP socket itself.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const saleId = Number(id);
  if (!Number.isFinite(saleId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const pool = getPool();
  const saleRes = await pool.query(
    `SELECT s.*, pl.receipt_header, pl.receipt_footer, pl.return_policy,
            pl.address_line1, pl.address_line2, pl.city, pl.state, pl.zip,
            pl.phone, pl.tax_rate,
            pl.printer_host, pl.printer_port,
            l.name AS location_name, r.name AS register_name,
            u.email AS cashier_email,
            c.first_name AS customer_first_name,
            c.last_name  AS customer_last_name,
            c.store_credit_balance AS customer_store_credit_balance
       FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id
       JOIN locations l      ON l.id = pl.wms_location_id
       JOIN pos_registers r  ON r.id = s.register_id
       JOIN pos_employees pe ON pe.id = s.cashier_id
       JOIN users u          ON u.id = pe.user_id
       LEFT JOIN pos_customers c ON c.id = s.customer_id
      WHERE s.id = $1`,
    [saleId],
  );
  const sale = saleRes.rows[0];
  if (!sale) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const linesRes = await pool.query(
    `SELECT * FROM pos_sale_lines WHERE sale_id = $1 ORDER BY id`,
    [saleId],
  );
  const paymentsRes = await pool.query(
    `SELECT * FROM pos_payments WHERE sale_id = $1 ORDER BY id`,
    [saleId],
  );
  const giftCardValue = linesRes.rows
    .filter((l) => l.line_type === "gift_card")
    .reduce((s, l) => s + Number(l.unit_price) * Number(l.quantity), 0);
  const earn = computeEarn({
    subtotal: sale.subtotal,
    discount: sale.discount_amount,
    gift_card_value: giftCardValue,
  });
  const payload = await buildSaleReceiptPayload({
    sale,
    lines: linesRes.rows,
    payments: paymentsRes.rows,
    loyalty: {
      is_member: sale.customer_id != null,
      points: earn.points,
      dollar_value: earn.dollar_value,
    },
  });
  return NextResponse.json(payload);
}
