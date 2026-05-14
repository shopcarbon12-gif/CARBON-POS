import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { posReaderForCurrentSession } from "@/lib/reader-control";

/**
 * GET /api/pos/hardware/reader/state
 *
 * Direct DB read of the POS-dedicated reader's per-row truth, NOT the
 * agent-wide WMS state endpoint. The agent serves multiple readers; we
 * only care about .69 (the one marked is_pos_dedicated=true). Reading
 * the device row gives us exactly that reader's pause + online status
 * without the OR-aggregation across siblings.
 *
 *   { ok: true, skipped: true, reason: "no_agent" }
 *     — register isn't linked to an agent / no POS-dedicated reader
 *
 *   { ok: true, reader_id, status_online, scan_paused, agent_active }
 *     — status_online: CDM watchdog's view of the chip
 *     — scan_paused:   per-reader Hardware Config pause flag
 *     — agent_active:  cdm_agents.live_scan_active (informational only;
 *                       POS doesn't write to this — warehouse does)
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const info = await posReaderForCurrentSession(cashier.user_id);
  if (!info) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_agent" });
  }
  return NextResponse.json({
    ok: true,
    reader_id: info.reader_id,
    status_online: info.status_online,
    scan_paused: info.scan_paused,
    agent_active: info.agent_live_scan_active,
  });
}
