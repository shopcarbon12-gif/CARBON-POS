import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/auth/locations
 * Returns every active location the calling user is granted access to via
 * `user_locations`. Used by the /locations/{code} switcher page.
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const pool = getPool();
  const r = await pool.query<{
    id: string;
    code: string;
    name: string;
  }>(
    `SELECT l.id::text, l.code, l.name
       FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
      WHERE ul.user_id = $1::uuid
        AND l.is_active = TRUE
      ORDER BY l.name ASC`,
    [cashier.user_id],
  );
  return NextResponse.json({
    current_location_id: cashier.lid,
    current_location_code: cashier.lcode,
    locations: r.rows,
  });
}
