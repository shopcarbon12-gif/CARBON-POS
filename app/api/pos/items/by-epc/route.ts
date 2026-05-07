import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  epcs: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * POST /api/pos/items/by-epc
 * Given a list of RFID EPCs (from the WMS Hardware SDK SSE stream), resolve
 * each to its sku. Used by the RFID Scan modal on the sell screen.
 *
 * Returns one row per epc that has a sku. EPCs already marked "sold" are
 * skipped — the cashier sees a count of skipped tags.
 *
 * Schema notes: the WMS unified the old `epcs` table into `items` — each row
 * has an `epc` column. The product name lives on `matrices.description`,
 * the variant attributes (color, size) live on `custom_skus`.
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
  const r = await pool.query(
    `SELECT i.epc,
            i.custom_sku_id     AS sku_id,
            i.status,
            cs.sku,
            m.description       AS item_name,
            cs.color_code       AS color,
            cs.size,
            cs.retail_price
       FROM items i
       LEFT JOIN custom_skus cs ON cs.id = i.custom_sku_id
       LEFT JOIN matrices m     ON m.id = cs.matrix_id
      WHERE i.epc = ANY($1::text[])`,
    [parsed.data.epcs],
  );
  const usable = r.rows.filter(
    (row) => row.sku_id && row.status !== "sold",
  );
  const skipped = parsed.data.epcs.length - usable.length;
  return NextResponse.json({ items: usable, skipped });
}
