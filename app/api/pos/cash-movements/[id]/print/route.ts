import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { printCashMovementSlip } from "@/lib/thermal-printer";

/**
 * POST /api/pos/cash-movements/:id/print
 * Prints the small audit slip for a cash drop / payout / add. Best-effort
 * — returns { skipped: true } when no printer is configured so the modal
 * can dismiss cleanly in dev.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const movementId = Number(id);
  if (!Number.isFinite(movementId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT m.id,
            m.type,
            m.amount::text,
            m.reason,
            m.created_at AS done_at,
            u.email      AS done_by_name,
            l.name       AS location_name,
            r.name       AS register_name
       FROM pos_cash_movements m
       JOIN pos_register_sessions s ON s.id = m.register_session_id
       JOIN pos_registers   r  ON r.id = s.register_id
       JOIN pos_locations   pl ON pl.id = r.pos_location_id
       JOIN locations       l  ON l.id = pl.wms_location_id
       JOIN users           u  ON u.id = m.done_by
      WHERE m.id = $1
      LIMIT 1`,
    [movementId],
  );
  const slip = r.rows[0];
  if (!slip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const result = await printCashMovementSlip({
      type: slip.type,
      amount: slip.amount,
      reason: slip.reason,
      done_at: slip.done_at,
      done_by_name: slip.done_by_name,
      location_name: slip.location_name,
      register_name: slip.register_name,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cash-movements/print]", err);
    return NextResponse.json(
      {
        error: "printer_failed",
        message: "Couldn't reach the receipt printer.",
      },
      { status: 502 },
    );
  }
}
