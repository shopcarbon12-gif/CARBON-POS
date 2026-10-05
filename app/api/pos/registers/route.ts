import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/registers
 * Lists every active register with its location info and any currently
 * open session. The register-picker uses this to show what's available.
 * `?mine=1` limits the list to the signed-in cashier's store.
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  const pool = getPool();
  const result = await pool.query(
    `SELECT r.id,
            r.name,
            r.pos_location_id,
            r.stripe_reader_id,
            r.stripe_reader_label,
            l.name AS location_name,
            (
              SELECT json_build_object(
                'id', s.id,
                'opened_by', s.opened_by,
                'opened_at', s.opened_at,
                'opening_cash', s.opening_cash
              )
                FROM pos_register_sessions s
               WHERE s.register_id = r.id
                 AND s.status = 'open'
               LIMIT 1
            ) AS open_session
       FROM pos_registers r
       JOIN pos_locations pl ON pl.id = r.pos_location_id
       JOIN locations l      ON l.id = pl.wms_location_id
      WHERE r.is_active = TRUE
        AND ($1::uuid IS NULL OR pl.wms_location_id = $1::uuid)
      ORDER BY l.name, r.name`,
    [mine ? cashier.lid : null],
  );
  return NextResponse.json({ registers: result.rows });
}
