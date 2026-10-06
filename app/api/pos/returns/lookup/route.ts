import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { loadReturnable } from "@/lib/returns";

/**
 * GET /api/pos/returns/lookup?number=<receipt # or scanned barcode>
 * GET /api/pos/returns/lookup?sale_id=<id>
 * A sale at this store with what's still returnable per line: tags sold
 * vs already returned, untagged quantity left, per-unit credit.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const number = sp.get("number")?.trim() || undefined;
  const saleId = Number(sp.get("sale_id")) || undefined;
  if (!number && !saleId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const sale = await loadReturnable(getPool(), { lid: cashier.lid, number, saleId });
  if (!sale) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ sale });
}
