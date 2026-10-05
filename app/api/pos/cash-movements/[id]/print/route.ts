import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { buildCashMovementSlip, printCashMovementSlip } from "@/lib/thermal-printer";
import { enqueuePrintJobs, locationPrintTarget } from "@/lib/print-queue";

/**
 * POST /api/pos/cash-movements/:id/print
 * Prints the small audit slip for a cash drop / payout / add. Goes
 * through the store print agent when it's online, else tries the printer
 * directly. Best-effort — returns { skipped: true } when no printer is
 * configured so the modal can dismiss cleanly in dev.
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
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''), u.email) AS done_by_name,
            pl.timezone,
            l.name       AS location_name,
            r.name       AS register_name,
            pl.printer_host,
            pl.printer_port
       FROM pos_cash_movements m
       JOIN pos_register_sessions s ON s.id = m.register_session_id
       JOIN pos_registers   r  ON r.id = s.register_id
       JOIN pos_locations   pl ON pl.id = r.pos_location_id
       JOIN locations       l  ON l.id = pl.wms_location_id
       JOIN users           u  ON u.id = m.done_by
      WHERE m.id = $1 AND pl.wms_location_id = $2::uuid
      LIMIT 1`,
    [movementId, cashier.lid],
  );
  const slip = r.rows[0];
  if (!slip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const data = {
    type: slip.type,
    amount: slip.amount,
    reason: slip.reason,
    done_at: slip.done_at,
    done_by_name: slip.done_by_name,
    location_name: slip.location_name,
    register_name: slip.register_name,
    timezone: slip.timezone,
    printer_host: slip.printer_host,
    printer_port: slip.printer_port,
  };
  const target = await locationPrintTarget(cashier.lid);
  if (target?.agent_online && target.printer_host) {
    const [jobId] = await enqueuePrintJobs(
      target.pos_location_id,
      [buildCashMovementSlip(data)],
      cashier.user_id,
    );
    return NextResponse.json({ ok: true, via: "agent", job_id: jobId });
  }
  try {
    const result = await printCashMovementSlip(data);
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
