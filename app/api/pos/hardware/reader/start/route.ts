import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  clearPosReaderPause,
  posReaderForCurrentSession,
  wakeAgentIfDormant,
} from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/start
 *
 * Asymmetric wake of the POS-dedicated reader:
 *   1. Flip cdm_agents.live_scan_active to TRUE if dormant — the
 *      supervisor will not spawn ANY reader binaries (warehouse or
 *      POS) while this flag is FALSE, so waking it is a prerequisite
 *      for our .69 reader to come up. Idempotent: if the warehouse
 *      already had the agent on, this is a no-op.
 *   2. Clear scan_paused_at on the POS-dedicated row so the spawned
 *      reader binary actually starts scanning.
 *
 * The matching stop path leaves live_scan_active alone (see
 * /reader/stop) so closing the sell screen never knocks the 14
 * warehouse readers offline.
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const info = await posReaderForCurrentSession(cashier.user_id);
  if (!info) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_agent" });
  }
  await wakeAgentIfDormant(info.agent_id, cashier.user_id);
  await clearPosReaderPause(info.reader_id);
  return NextResponse.json({
    ok: true,
    reader_id: info.reader_id,
    agent_id: info.agent_id,
  });
}
