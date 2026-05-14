import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import {
  posReaderForCurrentSession,
  setPosReaderPause,
} from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/stop
 *
 * Pause ONLY the POS-dedicated reader (`is_pos_dedicated=true`). The
 * 14 sibling warehouse readers under the same agent are not affected.
 * The CDM agent's tenant-wide live_scan_active is left untouched for
 * the same reason.
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
  await setPosReaderPause(info.reader_id, cashier.user_id);
  return NextResponse.json({ ok: true, reader_id: info.reader_id });
}
