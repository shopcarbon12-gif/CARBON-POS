import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  agentIdForCurrentSession,
  callAgentLiveScan,
} from "@/lib/reader-control";

/**
 * GET /api/pos/hardware/reader/state
 *
 * Reports the cashier register's reader status. The sell-screen badge
 * polls this every few seconds so the cashier sees the ground-truth
 * even if the start/stop call lost the race (network hiccup, manual
 * Hardware Config toggle in WMS, etc.).
 *
 * Returns one of:
 *   { agent_id, live_scan_active, reader_status_online, ... }   (linked)
 *   { ok: true, skipped: true, reason: "no_agent" }             (no reader)
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const agentId = await agentIdForCurrentSession(cashier.user_id);
  if (!agentId) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_agent" });
  }
  const result = await callAgentLiveScan(cashier, agentId, "state");
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, agent_id: agentId, ...result.data });
}
