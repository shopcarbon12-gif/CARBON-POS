import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { setScanningActive } from "@/lib/reader-control";

/**
 * POST /api/pos/hardware/reader/scanning   body: { active: boolean }
 *
 * Refreshes/clears `scanning_active_at` on the cashier's open register session.
 * The Scan RFID modal (sell screen) and the Update Item Status modal call this
 * with active:true on open and every ~15 s while open, and active:false on
 * close. The CDM agent applies its tighter "no tag reads in 30 s → recover"
 * rule only while scanning is active (a customer's item is being scanned).
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let active = true;
  try {
    const body = (await req.json()) as { active?: unknown };
    if (typeof body.active === "boolean") active = body.active;
  } catch {
    /* default active:true */
  }
  await setScanningActive(cashier.user_id, active);
  return NextResponse.json({ ok: true });
}
