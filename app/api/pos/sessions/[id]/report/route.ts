import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { loadRegisterReport } from "@/lib/register-report";

/**
 * GET /api/pos/sessions/:id/report
 * Full Open / End-of-Day report data for one register session at the
 * cashier's store. Used by the print screen after open/close and by the
 * Register Reports page in the Reports tab.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const report = await loadRegisterReport(sessionId, cashier.lid);
  if (!report) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(report);
}
