import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  posReaderForCurrentSession,
  scheduleReaderPause,
} from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/stop
 *
 * Pause ONLY the POS-dedicated reader (`is_pos_dedicated=true`), with a
 * 30 s grace window. Any /reader/start OR /reader/keepalive from any tab
 * within the window cancels the pending pause — so two tabs both using
 * the reader survive one of them closing. The pause only actually fires
 * if NO heartbeats arrive for the full window.
 *
 * The 14 sibling warehouse readers under the same agent are not
 * affected. The CDM agent's tenant-wide live_scan_active is left
 * untouched for the same reason.
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
  scheduleReaderPause(cashier.user_id, info.reader_id);
  return NextResponse.json({ ok: true, reader_id: info.reader_id, deferred_ms: 30_000 });
}
