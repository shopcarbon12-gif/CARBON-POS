import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { printSaleReceipt } from "@/lib/thermal-printer";
import { currentCashier } from "@/lib/session";

/**
 * POST /api/pos/sales/:id/print
 * Sends the receipt to the configured network thermal printer. If
 * THERMAL_PRINTER_HOST is empty, returns 200 { skipped: true } so the
 * caller can still proceed (useful in dev).
 */
export async function POST(
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
            pl.phone, l.name AS location_name, r.name AS register_name,
            u.email AS cashier_email
       FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id
       JOIN locations l      ON l.id = pl.wms_location_id
       JOIN pos_registers r  ON r.id = s.register_id
       JOIN pos_employees pe ON pe.id = s.cashier_id
       JOIN users u          ON u.id = pe.user_id
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
  try {
    const result = await printSaleReceipt({
      sale,
      lines: linesRes.rows,
      payments: paymentsRes.rows,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[print]", err);
    return NextResponse.json(
      {
        error: "printer_failed",
        message:
          "The receipt printer didn't respond. Check it's powered on and on the network.",
      },
      { status: 502 },
    );
  }
}
