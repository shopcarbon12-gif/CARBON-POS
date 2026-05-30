import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { getPool } from "@/lib/db";

/**
 * GET   /api/pos/hardware/reader/rssi-filter  → { rssi_threshold_dbm: number | null }
 * PATCH /api/pos/hardware/reader/rssi-filter   body: { rssiDbm: number | null }
 *
 * The POS reader runs at a CONSTANT 33 dBm (the agent pins it) and is never
 * reconfigured by the cashier — changing RF power is what wedged the chip.
 * Proximity is now a SOFTWARE filter: the reader sees everything, the cart/scan
 * UI shows only tags at/above this RSSI threshold (closer tag = higher RSSI).
 * This is purely a display filter; it never touches the radio.
 *
 * Stored on the cashier's open register session (`rssi_threshold_dbm`). RSSI is
 * negative dBm; range −90..−20 (DB check constraint). NULL = show everything
 * above the bridge's hard floor.
 */

const RSSI_MIN = -90;
const RSSI_MAX = -20;

export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await getPool().query<{ rssi_threshold_dbm: number | null }>(
    `SELECT rssi_threshold_dbm
       FROM pos_register_sessions
      WHERE status = 'open' AND opened_by = $1::uuid
      ORDER BY opened_at DESC
      LIMIT 1`,
    [cashier.user_id],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_session" });
  }
  return NextResponse.json({
    ok: true,
    rssi_threshold_dbm: r.rows[0].rssi_threshold_dbm,
  });
}

export async function PATCH(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const raw = (body as { rssiDbm?: unknown }).rssiDbm;
  let value: number | null;
  if (raw === null) {
    value = null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.round(raw);
    if (n < RSSI_MIN || n > RSSI_MAX) {
      return NextResponse.json(
        { error: `rssiDbm out of range (${RSSI_MIN}…${RSSI_MAX})` },
        { status: 400 },
      );
    }
    value = n;
  } else {
    return NextResponse.json(
      { error: "rssiDbm must be a number or null" },
      { status: 400 },
    );
  }
  const r = await getPool().query<{ id: number; rssi_threshold_dbm: number | null }>(
    `UPDATE pos_register_sessions
        SET rssi_threshold_dbm = $2
      WHERE status = 'open' AND opened_by = $1::uuid
      RETURNING id, rssi_threshold_dbm`,
    [cashier.user_id, value],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "no_open_session" }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    session_id: r.rows[0].id,
    rssi_threshold_dbm: r.rows[0].rssi_threshold_dbm,
  });
}
