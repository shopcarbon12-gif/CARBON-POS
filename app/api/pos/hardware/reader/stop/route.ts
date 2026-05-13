import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  agentIdForCurrentSession,
  callAgentLiveScan,
} from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/stop
 *
 * Stops the reader on this cashier's register. Auto-fired by the
 * sell-screen on unmount (sale completed → /receipt redirect, cashier
 * navigated away, tab closed) and by the 5-minute idle timer. The cashier
 * can also force-stop via the badge during a sale.
 *
 * Idempotent. "no_agent" → 200 ok, skipped.
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const agentId = await agentIdForCurrentSession(cashier.user_id);
  if (!agentId) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_agent" });
  }
  const result = await callAgentLiveScan(cashier, agentId, "stop");
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, agent_id: agentId, wms: result.data });
}
