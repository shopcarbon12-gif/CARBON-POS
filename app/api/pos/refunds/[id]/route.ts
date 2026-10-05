import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { loadRefundReceipt } from "@/lib/refund-receipt";

/**
 * GET /api/pos/refunds/:id
 * Refund receipt data (see lib/refund-receipt.ts) for a refund at the
 * cashier's store.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const refundId = Number((await ctx.params).id);
  if (!Number.isFinite(refundId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const data = await loadRefundReceipt(refundId, cashier.lid);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}
