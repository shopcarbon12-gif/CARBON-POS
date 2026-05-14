import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  clearPosReaderPause,
  posReaderForCurrentSession,
} from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/start
 *
 * Clear the per-reader pause flag on the POS-dedicated reader ONLY.
 * The CDM agent's tenant-wide `live_scan_active` is left untouched —
 * the agent serves 14 warehouse readers in addition to .69 and POS
 * must never affect those. Combined with an already-active agent
 * (which the warehouse manages independently), this brings the POS
 * reader back up.
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
  await clearPosReaderPause(info.reader_id);
  return NextResponse.json({ ok: true, reader_id: info.reader_id });
}
