import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { getReplenishmentLines, REPLENISHMENT_LOCATION_CODE } from "@/lib/store-replenishment";

/**
 * GET /api/pos/store-replenishment/[saleId] — read-only: the sale's items and
 * which were replenished on the CarbonWMS handheld. Orlando Warehouse (001) only.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ saleId: string }> }) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (cashier.lcode !== REPLENISHMENT_LOCATION_CODE) {
    return NextResponse.json({ error: "Store replenishment is only for the Orlando Warehouse." }, { status: 403 });
  }
  const { saleId } = await params;
  if (!/^\d{1,10}$/.test(saleId)) return NextResponse.json({ error: "Bad sale id" }, { status: 400 });
  try {
    const lines = await getReplenishmentLines(getPool(), cashier.lid, Number(saleId));
    if (!lines) return NextResponse.json({ error: "Sale not found" }, { status: 404 });
    return NextResponse.json({ lines }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[pos/store-replenishment/sale]", e);
    return NextResponse.json({ error: "Could not load the sale" }, { status: 500 });
  }
}
