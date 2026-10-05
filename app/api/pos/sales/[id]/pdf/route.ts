import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { loadReceiptData, renderReceiptPdf } from "@/lib/receipt-pdf";

/**
 * GET /api/pos/sales/:id/pdf
 * The customer PDF receipt (same file the receipt email attaches), shown
 * inline so staff can view, print or forward it.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const saleId = Number((await ctx.params).id);
  if (!Number.isFinite(saleId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const data = await loadReceiptData(saleId, cashier.lid);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const pdf = await renderReceiptPdf(data);
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Carbon-Jeans-receipt-${data.sale.sale_number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
