import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { armPosMonitor, markReaderHeartbeat } from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/keepalive
 *
 * Heartbeat from each open reader-using surface (sell screen, Update
 * Status modal). Called every ~15 s while the surface is mounted. Refreshes
 * `monitor_armed_at` so the agent keeps the reader armed (self-healing) while
 * a cashier is present; when the surface unmounts the heartbeat stops and the
 * arm goes stale (~30 s grace), disarming recovery.
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  markReaderHeartbeat(cashier.user_id);
  await armPosMonitor(cashier.user_id);
  return NextResponse.json({ ok: true });
}
