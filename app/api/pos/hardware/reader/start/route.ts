import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  agentAndReadersForCurrentSession,
  callAgentLiveScan,
  clearReaderPause,
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
  const linked = await agentAndReadersForCurrentSession(cashier.user_id);
  if (!linked) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_agent" });
  }
  // 1. Clear devices.scan_paused_at on every reader under the agent —
  //    same write Hardware Config's Start button does. Without this,
  //    the CDM supervisor's "should I spawn?" check stays false even
  //    after live_scan_active=true.
  await clearReaderPause(linked.reader_ids);
  // 2. Flip the agent's live_scan_active to true via WMS.
  const result = await callAgentLiveScan(cashier, linked.agent_id, "start");
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    agent_id: linked.agent_id,
    reader_ids: linked.reader_ids,
    wms: result.data,
  });
}
