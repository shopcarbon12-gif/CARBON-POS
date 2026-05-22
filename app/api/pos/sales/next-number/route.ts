import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatSaleNumber } from "@/lib/utils";
import { ean13Display } from "@/lib/barcode";

/**
 * GET /api/pos/sales/next-number?register_id=<id>
 *
 * Returns a PREVIEW of the sale_number the next completed sale on this
 * register will receive. Read-only — does NOT bump pos_locations.next_sale_seq.
 * Used by the SellScreen cart header to display "Sale 010012" before
 * the cashier actually closes the sale.
 *
 * Two concurrent cashiers at the same store will see the same preview,
 * but only one will actually receive that seq when their sale completes
 * (the capture route's UPDATE … RETURNING is atomic). The other ends up
 * with the next seq. Fine for a header label — not for anything load-bearing.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const registerId = Number(url.searchParams.get("register_id"));
  if (!Number.isFinite(registerId)) {
    return NextResponse.json({ error: "bad_register_id" }, { status: 400 });
  }
  const r = await getPool().query<{
    pos_location_id: number;
    store_code: string;
    next_sale_seq: number;
  }>(
    `SELECT pl.id  AS pos_location_id,
            pl.store_code,
            pl.next_sale_seq
       FROM pos_registers r
       JOIN pos_locations pl ON pl.id = r.pos_location_id
      WHERE r.id = $1
      LIMIT 1`,
    [registerId],
  );
  const row = r.rows[0];
  if (!row) {
    return NextResponse.json({ error: "register_not_found" }, { status: 404 });
  }
  const sale_number = formatSaleNumber(
    row.store_code,
    row.next_sale_seq,
  );
  // Human-friendly short label printed in the cart header: location code +
  // sequence + EAN-13 check digit. e.g. "010012".
  const display = ean13Display(sale_number).slice(-6);
  return NextResponse.json({
    sale_number, // 12-digit DB form
    ticket: ean13Display(sale_number), // 13-digit EAN-13 ticket
    display, // 6-char "Sale #" the cashier sees in the cart
    location_id: row.pos_location_id,
    next_sale_seq: row.next_sale_seq,
  });
}
