import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/pos/auth/locations-for-user
 *
 * Step 1 of the new (employee-based) POS sign-in: verify the employee's email
 * + POS password and return the locations they can sign in to. The sign-in
 * page then completes via signIn("password", { email, password, locationId }).
 *
 * 401 on bad credentials; never reveals which half was wrong.
 */
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { email, password } = parsed.data;
  const pool = getPool();

  const emp = await pool.query<{
    user_id: string;
    pos_password_hash: string | null;
    user_password_hash: string | null;
  }>(
    `SELECT pe.user_id,
            pe.pos_password_hash,
            u.password_hash AS user_password_hash
       FROM pos_employees pe
       JOIN users u ON u.id = pe.user_id
      WHERE lower(u.email) = lower($1) AND pe.is_active = TRUE
      LIMIT 1`,
    [email],
  );
  const row = emp.rows[0];
  if (!row) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const hash = row.pos_password_hash || row.user_password_hash;
  if (!hash || !(await bcrypt.compare(password, hash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  // Locations the employee is assigned to (active). If they have no explicit
  // assignment, fall back to every active location in their tenant(s).
  let locs = await pool.query<{ id: string; code: string; name: string }>(
    `SELECT l.id::text, l.code, l.name
       FROM user_locations ul
       JOIN locations l ON l.id = ul.location_id
      WHERE ul.user_id = $1::uuid AND l.is_active = TRUE
      ORDER BY l.code ASC`,
    [row.user_id],
  );
  if (locs.rows.length === 0) {
    locs = await pool.query<{ id: string; code: string; name: string }>(
      `SELECT DISTINCT l.id::text, l.code, l.name
         FROM memberships m
         JOIN locations l ON l.tenant_id = m.tenant_id
        WHERE m.user_id = $1::uuid AND l.is_active = TRUE
        ORDER BY l.code ASC`,
      [row.user_id],
    );
  }
  if (locs.rows.length === 0) {
    return NextResponse.json(
      { error: "no_location", message: "No location is assigned to this login." },
      { status: 403 },
    );
  }
  return NextResponse.json({ locations: locs.rows });
}
