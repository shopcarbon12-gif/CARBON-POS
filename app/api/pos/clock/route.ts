import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/clock — the signed-in employee's open shift (if any) and
 * minutes worked today (store-local day).
 * POST /api/pos/clock { action: "in" | "out" } — clock in / out.
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await status(cashier.employee_id, cashier.lid));
}

const bodySchema = z.object({ action: z.enum(["in", "out"]) });

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const pool = getPool();
  const open = await pool.query(
    `SELECT id FROM pos_employee_clock
      WHERE employee_id = $1 AND clock_out IS NULL
      ORDER BY clock_in DESC LIMIT 1`,
    [cashier.employee_id],
  );
  if (parsed.data.action === "in") {
    if (open.rows[0]) {
      return NextResponse.json(
        { error: "already_in", message: "You're already clocked in." },
        { status: 409 },
      );
    }
    // Tie the shift to the register this employee has open here, if any.
    await pool.query(
      `INSERT INTO pos_employee_clock (employee_id, register_id)
       VALUES ($1, (SELECT r.id FROM pos_register_sessions s
                      JOIN pos_registers r  ON r.id = s.register_id
                      JOIN pos_locations pl ON pl.id = r.pos_location_id
                     WHERE s.status = 'open' AND s.opened_by = $2::uuid
                       AND pl.wms_location_id = $3::uuid
                     LIMIT 1))`,
      [cashier.employee_id, cashier.user_id, cashier.lid],
    );
  } else {
    if (!open.rows[0]) {
      return NextResponse.json(
        { error: "not_in", message: "You're not clocked in." },
        { status: 409 },
      );
    }
    await pool.query(`UPDATE pos_employee_clock SET clock_out = now() WHERE id = $1`, [
      open.rows[0].id,
    ]);
  }
  return NextResponse.json(await status(cashier.employee_id, cashier.lid));
}

async function status(employeeId: number, lid: string) {
  const r = await getPool().query(
    `WITH tz AS (
       SELECT COALESCE((SELECT timezone FROM pos_locations WHERE wms_location_id = $2::uuid LIMIT 1),
                       'America/New_York') AS tz
     )
     SELECT (SELECT row_to_json(x) FROM (
               SELECT id, clock_in FROM pos_employee_clock
                WHERE employee_id = $1 AND clock_out IS NULL
                ORDER BY clock_in DESC LIMIT 1) x) AS open,
            (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out, now()) - clock_in))) / 60, 0)
               FROM pos_employee_clock, tz
              WHERE employee_id = $1
                AND (clock_in AT TIME ZONE tz.tz)::date = (now() AT TIME ZONE tz.tz)::date) AS today_minutes`,
    [employeeId, lid],
  );
  return {
    open: r.rows[0].open as { id: number; clock_in: string } | null,
    today_minutes: Math.round(Number(r.rows[0].today_minutes)),
  };
}
