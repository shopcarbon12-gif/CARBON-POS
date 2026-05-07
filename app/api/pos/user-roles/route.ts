import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

/**
 * GET /api/pos/user-roles
 * Returns scope='pos' rows from the shared user_roles table — these are the
 * POS roles created from the WMS back office. Filters out "Super Admin" and
 * "Manager" for callers whose POS role isn't admin/super-admin, so a
 * regular Manager assigning a cashier can't see (and therefore can't
 * promote anyone to) those two roles.
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pool = getPool();
  const r = await pool.query<{
    id: number;
    name: string;
  }>(
    `SELECT id, name
       FROM user_roles
      WHERE scope = 'pos'
      ORDER BY id ASC`,
  );

  // Heuristic: a caller whose pos_employees.role is 'admin' (legacy enum) is
  // treated as super-admin and sees every POS role. Everyone else gets the
  // restricted list. When pos_role_id (the new FK) replaces the legacy text
  // role across the codebase, we'll switch this gate to the role's name.
  const isPrivileged = cashier.role === "admin";
  const restricted = isPrivileged
    ? r.rows
    : r.rows.filter((row) => row.name !== "Super Admin" && row.name !== "Manager");

  return NextResponse.json({ roles: restricted });
}
