import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { markReaderHeartbeat } from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/keepalive
 *
 * Heartbeat from each open reader-using surface (sell screen, Update
 * Status modal). Called every ~15 s while the surface is mounted.
 * Cancels any pending grace-pause from a recent /reader/stop so other
 * still-open tabs keep the reader alive.
 *
 * Cheap on purpose — no DB writes. Just bumps an in-memory timestamp.
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  markReaderHeartbeat(cashier.user_id);
  return NextResponse.json({ ok: true });
}
