import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { listReplenishmentSales, REPLENISHMENT_LOCATION_CODE } from "@/lib/store-replenishment";

/**
 * GET /api/pos/store-replenishment?fromDate=&toDate= (YYYY-MM-DD, store-local,
 * inclusive; default today) — read-only: which showroom sales have been
 * replenished on the CarbonWMS handheld. Orlando Warehouse (001) only.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (cashier.lcode !== REPLENISHMENT_LOCATION_CODE) {
    return NextResponse.json({ error: "Store replenishment is only for the Orlando Warehouse." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  try {
    const sales = await listReplenishmentSales(getPool(), cashier.lid, {
      fromDate: day(sp.get("fromDate")),
      toDate: day(sp.get("toDate")),
    });
    return NextResponse.json({ sales }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[pos/store-replenishment]", e);
    return NextResponse.json({ error: "Could not load replenishment" }, { status: 500 });
  }
}
