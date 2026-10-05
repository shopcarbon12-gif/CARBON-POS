import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * POST   /api/pos/held-sales/:id — resume: returns the parked cart and
 *        removes it (atomically, so two registers can't both resume it).
 * DELETE /api/pos/held-sales/:id — discard a parked cart.
 */
async function take(id: number, lid: string) {
  const r = await getPool().query(
    `DELETE FROM pos_held_sales h
      USING pos_locations pl
      WHERE h.id = $1 AND pl.id = h.pos_location_id AND pl.wms_location_id = $2::uuid
      RETURNING h.cart`,
    [id, lid],
  );
  return r.rows[0]?.cart ?? null;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cart = await take(Number((await ctx.params).id), cashier.lid);
  if (!cart) {
    return NextResponse.json(
      { error: "not_found", message: "That held sale was already resumed or removed." },
      { status: 404 },
    );
  }
  return NextResponse.json({ cart });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await take(Number((await ctx.params).id), cashier.lid);
  return NextResponse.json({ ok: true });
}
