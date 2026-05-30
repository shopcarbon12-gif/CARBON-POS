import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { setScanningActive } from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/stop
 *
 * Leaving a scan surface. We DO NOT pause the reader anymore — the POS reader
 * runs on its per-reader schedule (always-warm during store hours) and is
 * never torn down per-session (that teardown wedged the chip under the
 * reverted f0e536e). We just clear `scanning_active_at`; `monitor_armed_at`
 * goes stale on its own (~30 s) once heartbeats stop, which disarms recovery
 * and — outside store hours only — lets the reader cold-stop after the grace.
 */
export async function POST() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await setScanningActive(cashier.user_id, false);
  return NextResponse.json({ ok: true });
}
