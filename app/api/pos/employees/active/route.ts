import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/employees/active
 *
 * Lightweight list of active pos_employees for the Cart attribution
 * dropdown. Any signed-in cashier can call this — unlike
 * /api/pos/employees which is manager/admin only because it exposes
 * PIN-management fields.
 *
 * Returns: id, email, display_name (email prefix, prettified).
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const pool = getPool();
  const r = await pool.query<{ id: number; email: string }>(
    `SELECT pe.id, u.email
       FROM pos_employees pe
       JOIN users u ON u.id = pe.user_id
      WHERE pe.is_active = TRUE
      ORDER BY u.email`,
  );
  const employees = r.rows.map((row) => ({
    id: row.id,
    email: row.email,
    display_name: prettify(row.email),
  }));
  return NextResponse.json({ employees });
}

/** "eli.cohen@shopcarbon.com" → "Eli Cohen" */
function prettify(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
