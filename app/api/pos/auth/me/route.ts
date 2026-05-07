import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/auth/me
 * Lightweight profile lookup for the chrome. Returns the active location
 * name + whether the cashier has access to more than one location (drives
 * the "highlighted location box" under the logo).
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const pool = getPool();
  const [locR, countR] = await Promise.all([
    pool.query<{ name: string; code: string }>(
      `SELECT name, code FROM locations WHERE id = $1::uuid LIMIT 1`,
      [cashier.lid],
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM user_locations ul
         JOIN locations l ON l.id = ul.location_id
        WHERE ul.user_id = $1::uuid
          AND l.is_active = TRUE`,
      [cashier.user_id],
    ),
  ]);
  const accessible = Number(countR.rows[0]?.n ?? 0);
  return NextResponse.json({
    role: cashier.role,
    email: cashier.email,
    location_id: cashier.lid,
    location_code: locR.rows[0]?.code ?? cashier.lcode,
    location_name: locR.rows[0]?.name ?? cashier.lcode,
    accessible_location_count: accessible,
    can_switch_location: accessible >= 2,
  });
}
