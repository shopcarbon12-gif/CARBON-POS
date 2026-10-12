import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { listInventory, parseInventorySort } from "@/lib/inventory-list";

/**
 * GET /api/pos/inventory?q=...&sort=...&dir=...&page=...
 *
 * Drives the Products tab: live search, paging, and the background
 * refresh that keeps the table in step with WMS (lib/inventory-list).
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const data = await listInventory({
    lid: cashier.lid,
    q: (url.searchParams.get("q") ?? "").trim(),
    sort: parseInventorySort(url.searchParams.get("sort")),
    dir: url.searchParams.get("dir") === "desc" ? "desc" : "asc",
    page: Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1),
  });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
