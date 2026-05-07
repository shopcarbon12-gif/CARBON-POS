import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { printRegisterOpenSlip } from "@/lib/thermal-printer";

/**
 * POST /api/pos/sessions/:id/print-open
 * Prints the small "register opened with $X" audit slip after the
 * cashier opens a new session.
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
  const sessionId = Number(id);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT s.opening_cash::text,
            s.opened_at,
            u.email AS opened_by_name,
            l.name  AS location_name,
            r.name  AS register_name
       FROM pos_register_sessions s
       JOIN pos_registers   r  ON r.id = s.register_id
       JOIN pos_locations   pl ON pl.id = r.pos_location_id
       JOIN locations       l  ON l.id = pl.wms_location_id
       JOIN users           u  ON u.id = s.opened_by
      WHERE s.id = $1
      LIMIT 1`,
    [sessionId],
  );
  const slip = r.rows[0];
  if (!slip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const result = await printRegisterOpenSlip({
      opening_cash: slip.opening_cash,
      opened_at: slip.opened_at,
      opened_by_name: slip.opened_by_name,
      location_name: slip.location_name,
      register_name: slip.register_name,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sessions/print-open]", err);
    return NextResponse.json(
      {
        error: "printer_failed",
        message: "Couldn't reach the receipt printer.",
      },
      { status: 502 },
    );
  }
}
