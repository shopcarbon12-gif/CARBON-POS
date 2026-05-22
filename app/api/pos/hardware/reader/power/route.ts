import { NextResponse } from "next/server";
import { currentCashier } from "@/lib/session";
import { getPool } from "@/lib/db";

/**
 * GET  /api/pos/hardware/reader/power  → { live_power_dbm: number | null }
 * PATCH /api/pos/hardware/reader/power  body: { powerDbm: number }
 *
 * Cashier-driven live RF power override on the cashier's currently-open
 * register session. Updates `pos_register_sessions.live_power_dbm`; the
 * agent's `/api/cdm-agents/active-sessions` poll surfaces this column as a
 * `posOverrides[]` entry. Agent applies it as the supervisor spawn power
 * for the is_pos_dedicated reader bound to this register's agent.
 *
 * No save button on the slider — every drag PATCHes here. Debounce
 * client-side (~200 ms). Propagation: PATCH (≤100 ms) → agent's next
 * 100 ms poll → supervisor respawn on power change (≤2 s). ≈2 s end-to-end.
 *
 * Range gate enforced by the DB check constraint (1–33). NULL = clear override
 * (revert to WMS-configured power on next supervisor respawn).
 */

export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await getPool().query<{ live_power_dbm: number | null }>(
    `SELECT live_power_dbm
       FROM pos_register_sessions
      WHERE status = 'open' AND opened_by = $1::uuid
      ORDER BY opened_at DESC
      LIMIT 1`,
    [cashier.user_id],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_session" });
  }
  return NextResponse.json({ ok: true, live_power_dbm: r.rows[0].live_power_dbm });
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
  const raw = (body as { powerDbm?: unknown }).powerDbm;
  // null clears the override; number sets it; anything else is invalid.
  let value: number | null;
  if (raw === null) {
    value = null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.round(raw);
    if (n < 1 || n > 33) {
      return NextResponse.json({ error: "powerDbm out of range (1–33)" }, { status: 400 });
    }
    value = n;
  } else {
    return NextResponse.json({ error: "powerDbm must be a number or null" }, { status: 400 });
  }
  const r = await getPool().query<{ id: number; live_power_dbm: number | null }>(
    `UPDATE pos_register_sessions
        SET live_power_dbm = $2
      WHERE status = 'open' AND opened_by = $1::uuid
      RETURNING id, live_power_dbm`,
    [cashier.user_id, value],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "no_open_session" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, session_id: r.rows[0].id, live_power_dbm: r.rows[0].live_power_dbm });
}
