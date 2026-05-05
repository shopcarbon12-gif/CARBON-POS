import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const createSchema = z.object({
  email: z.string().email(),
  pin: z.string().regex(/^\d{4}$/),
  role: z.enum(["cashier", "supervisor", "manager", "admin"]),
  /**
   * Optional: a fresh password to set on the WMS users row, e.g. when
   * onboarding a brand-new manager who doesn't have one yet. We never
   * change a password by accident — only when the caller passes this.
   */
  set_password: z.string().min(8).max(200).optional(),
});

/**
 * GET  /api/pos/employees   — list active employees + their email/role
 * POST /api/pos/employees   — link an existing WMS users row as a pos_employee
 *                             (or create their PIN if they're new to POS).
 *                             Manager / admin only.
 */
export async function GET() {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT pe.id, pe.user_id, pe.role, pe.is_active, pe.created_at,
            u.email
       FROM pos_employees pe
       JOIN users u ON u.id = pe.user_id
      ORDER BY pe.is_active DESC, u.email`,
  );
  return NextResponse.json({ employees: r.rows });
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, pin, role, set_password } = parsed.data;
  const pool = getPool();
  const u = await pool.query(
    `SELECT id, password_hash FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  let userId = u.rows[0]?.id;
  if (!userId) {
    return NextResponse.json(
      {
        error: "user_not_found",
        message:
          "No WMS user with that email. Have them sign up in WMS first, then come back here.",
      },
      { status: 404 },
    );
  }
  if (set_password) {
    const newHash = await bcrypt.hash(set_password, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      newHash,
      userId,
    ]);
  }

  const pinHash = await bcrypt.hash(pin, 10);
  // Re-activate / update if they already have a row (e.g. a re-hire) so
  // the unique(user_id) index on pos_employees doesn't collide.
  const ins = await pool.query(
    `INSERT INTO pos_employees (user_id, pin_hash, role, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (user_id) DO UPDATE
       SET pin_hash  = EXCLUDED.pin_hash,
           role      = EXCLUDED.role,
           is_active = TRUE
     RETURNING id, user_id, role, is_active, created_at`,
    [userId, pinHash, role],
  );
  return NextResponse.json({ employee: ins.rows[0] });
}
