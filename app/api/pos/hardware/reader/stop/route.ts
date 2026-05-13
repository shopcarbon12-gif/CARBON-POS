import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  agentAndReadersForCurrentSession,
  callAgentLiveScan,
  setReaderPause,
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
  const linked = await agentAndReadersForCurrentSession(cashier.user_id);
  if (!linked) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_agent" });
  }
  // Symmetric with start: also stamp scan_paused_at on every reader
  // under the agent so the supervisor stops spawning the binary even
  // if some other path leaves live_scan_active=true behind.
  await setReaderPause(linked.reader_ids, cashier.user_id);
  const result = await callAgentLiveScan(cashier, linked.agent_id, "stop");
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
