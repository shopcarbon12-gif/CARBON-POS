import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  agentIdForCurrentSession,
  callAgentLiveScan,
} from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/start
 *
 * Tells the CDM agent linked to the cashier's open register to power on
 * its reader. Auto-fired by the sell-screen on mount; cashier can also
 * trigger via the reader-status badge. Idempotent — calling start on an
 * already-on reader is a no-op upstream.
 *
 * Per-register isolation: the agent_id comes from the cashier's open
 * pos_register_session, so cashier A starting their reader doesn't touch
 * cashier B's. Requires WMS's per-agent live-scan endpoint (separate from
 * the tenant-wide dashboard/live-scan/start used by Operations).
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const agentId = await agentIdForCurrentSession(cashier.user_id);
  if (!agentId) {
    // No reader linked to this register — succeed quietly so the
    // sell-screen mount effect doesn't show an error toast.
    return NextResponse.json({ ok: true, skipped: true, reason: "no_agent" });
  }
  const result = await callAgentLiveScan(cashier, agentId, "start");
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, agent_id: agentId, wms: result.data });
}
