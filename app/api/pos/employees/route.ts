import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool, withTransaction } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { legacyRoleForPosRoleName } from "@/lib/pos-roles";

const createSchema = z.object({
  email: z.string().email(),
  pin: z.string().regex(/^\d{4}$/),
  first_name: z.string().max(120).optional().nullable(),
  last_name: z.string().max(120).optional().nullable(),
  role: z.enum(["cashier", "supervisor", "manager", "admin"]).optional(),
  /** Real POS role (user_roles scope='pos'). Drives the legacy `role` text. */
  pos_role_id: z.number().int().positive().optional(),
  /** Optional per-user POS password (stored on users.password_hash +
   *  pos_employees.pos_password_hash). POS PIN login doesn't need it, but the
   *  upcoming email+password POS login will. */
  set_password: z.string().min(8).max(200).optional(),
});

/**
 * GET  /api/pos/employees — list employees + email/role.
 * POST /api/pos/employees — create (or re-link) a POS-only login for THIS
 *   location. Mirrors the WMS "Add POS manager" model so the user shows up and
 *   is manageable in wms.shopcarbon.com/settings/users:
 *     users (role_id NULL → POS-only, no WMS access)
 *     + memberships (tenant, 'member')
 *     + user_locations (the creator's signed-in location only)
 *     + pos_employees (PIN, pos_role_id, password hash)
 *   Manager / admin only.
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
  if (!cashier.tid || !cashier.lid) {
    return NextResponse.json(
      { error: "no_location", message: "Your session has no active location." },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, pin, first_name, last_name, role, pos_role_id, set_password } =
    parsed.data;
  const pool = getPool();

  // Derive the legacy role text from the chosen POS role (keeps the
  // CHECK-constrained column valid + in lockstep). Fall back to an explicit
  // legacy role, then cashier.
  let legacyRole: "cashier" | "supervisor" | "manager" | "admin" =
    role ?? "cashier";
  if (pos_role_id) {
    const rn = await pool.query<{ name: string }>(
      `SELECT name FROM user_roles WHERE id = $1 AND scope = 'pos'`,
      [pos_role_id],
    );
    if (rn.rows[0]) legacyRole = legacyRoleForPosRoleName(rn.rows[0].name);
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const passwordHash = set_password ? await bcrypt.hash(set_password, 10) : null;

  try {
    const employee = await withTransaction(async (client) => {
      // Find or create the underlying users row.
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
        [email],
      );
      let userId = existing.rows[0]?.id;
      if (userId) {
        // Link an existing user — update name / password only when supplied.
        const sets: string[] = [];
        const args: unknown[] = [];
        if (first_name !== undefined) {
          args.push(first_name);
          sets.push(`first_name = $${args.length}`);
        }
        if (last_name !== undefined) {
          args.push(last_name);
          sets.push(`last_name = $${args.length}`);
        }
        if (passwordHash) {
          args.push(passwordHash);
          sets.push(`password_hash = $${args.length}`);
        }
        if (sets.length > 0) {
          args.push(userId);
          await client.query(
            `UPDATE users SET ${sets.join(", ")} WHERE id = $${args.length}::uuid`,
            args,
          );
        }
      } else {
        // Brand-new POS-only login: role_id NULL means no WMS access.
        const created = await client.query<{ id: string }>(
          `INSERT INTO users (id, email, password_hash, first_name, last_name, role_id)
           VALUES (gen_random_uuid(), lower($1), $2, $3, $4, NULL)
           RETURNING id`,
          [email, passwordHash, first_name ?? null, last_name ?? null],
        );
        userId = created.rows[0].id;
      }

      // Tenant membership (WMS scoping) + location assignment (this store only).
      await client.query(
        `INSERT INTO memberships (user_id, tenant_id, role)
         VALUES ($1::uuid, $2::uuid, 'member')
         ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        [userId, cashier.tid],
      );
      await client.query(
        `INSERT INTO user_locations (user_id, location_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT DO NOTHING`,
        [userId, cashier.lid],
      );

      // POS employee row (PIN + role). pos_password_hash only when a password
      // was supplied.
      const ins = await client.query(
        `INSERT INTO pos_employees
           (user_id, pin_hash, role, is_active, pos_role_id, pos_password_hash)
         VALUES ($1::uuid, $2, $3, TRUE, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET pin_hash          = EXCLUDED.pin_hash,
               role              = EXCLUDED.role,
               is_active         = TRUE,
               pos_role_id       = EXCLUDED.pos_role_id,
               pos_password_hash = COALESCE(EXCLUDED.pos_password_hash, pos_employees.pos_password_hash)
         RETURNING id, user_id, role, is_active, created_at`,
        [userId, pinHash, legacyRole, pos_role_id ?? null, passwordHash],
      );
      return ins.rows[0];
    });
    return NextResponse.json({ employee });
  } catch (err) {
    console.error("[employees/create]", err);
    return NextResponse.json(
      {
        error: "create_failed",
        message: "Couldn't create the employee. Try again.",
      },
      { status: 500 },
    );
  }
}
