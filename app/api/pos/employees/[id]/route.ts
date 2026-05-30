import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool, withTransaction } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { legacyRoleForPosRoleName } from "@/lib/pos-roles";

const patchSchema = z.object({
  first_name: z.string().max(120).nullable().optional(),
  last_name: z.string().max(120).nullable().optional(),
  email: z.string().email().max(256).optional(),
  /** Real POS role (user_roles scope='pos'). Legacy `role` text is kept in
   *  lockstep automatically. */
  pos_role_id: z.number().int().positive().optional(),
  role: z.enum(["cashier", "supervisor", "manager", "admin"]).optional(),
  is_active: z.boolean().optional(),
  pin: z.string().regex(/^\d{4}$/).optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const eid = Number(id);
  if (!Number.isFinite(eid)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT pe.*, u.email
       FROM pos_employees pe JOIN users u ON u.id = pe.user_id
      WHERE pe.id = $1`,
    [eid],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const clock = await pool.query(
    `SELECT id, clock_in, clock_out, register_id
       FROM pos_employee_clock
      WHERE employee_id = $1
      ORDER BY clock_in DESC
      LIMIT 50`,
    [eid],
  );
  return NextResponse.json({ employee: r.rows[0], clock: clock.rows });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const eid = Number(id);
  if (!Number.isFinite(eid)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const pool = getPool();

  // Resolve the employee's underlying user_id (name/email live on `users`).
  const cur = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM pos_employees WHERE id = $1`,
    [eid],
  );
  if (cur.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const userId = cur.rows[0].user_id;

  // Email is the shared login identity — guard uniqueness before touching it.
  if (d.email !== undefined) {
    const dup = await pool.query(
      `SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2::uuid LIMIT 1`,
      [d.email, userId],
    );
    if (dup.rows.length > 0) {
      return NextResponse.json(
        { error: "email_taken", message: "That email is already in use by another user." },
        { status: 409 },
      );
    }
  }

  // If the POS role changed, keep the legacy `role` text in lockstep (unless
  // an explicit legacy role was also passed).
  let legacyRole = d.role;
  if (d.pos_role_id !== undefined && legacyRole === undefined) {
    const rn = await pool.query<{ name: string }>(
      `SELECT name FROM user_roles WHERE id = $1 AND scope = 'pos'`,
      [d.pos_role_id],
    );
    if (rn.rows[0]) legacyRole = legacyRoleForPosRoleName(rn.rows[0].name);
  }

  // Build the two updates.
  const userSets: string[] = [];
  const userArgs: unknown[] = [];
  if (d.first_name !== undefined) {
    userArgs.push(d.first_name);
    userSets.push(`first_name = $${userArgs.length}`);
  }
  if (d.last_name !== undefined) {
    userArgs.push(d.last_name);
    userSets.push(`last_name = $${userArgs.length}`);
  }
  if (d.email !== undefined) {
    userArgs.push(d.email);
    userSets.push(`email = $${userArgs.length}`);
  }

  const peSets: string[] = [];
  const peArgs: unknown[] = [];
  if (d.pos_role_id !== undefined) {
    peArgs.push(d.pos_role_id);
    peSets.push(`pos_role_id = $${peArgs.length}`);
  }
  if (legacyRole !== undefined) {
    peArgs.push(legacyRole);
    peSets.push(`role = $${peArgs.length}`);
  }
  if (d.is_active !== undefined) {
    peArgs.push(d.is_active);
    peSets.push(`is_active = $${peArgs.length}`);
  }
  if (d.pin !== undefined) {
    peArgs.push(await bcrypt.hash(d.pin, 10));
    peSets.push(`pin_hash = $${peArgs.length}`);
  }

  if (userSets.length === 0 && peSets.length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const employee = await withTransaction(async (client) => {
    if (userSets.length > 0) {
      userArgs.push(userId);
      await client.query(
        `UPDATE users SET ${userSets.join(", ")} WHERE id = $${userArgs.length}::uuid`,
        userArgs,
      );
    }
    if (peSets.length > 0) {
      peArgs.push(eid);
      await client.query(
        `UPDATE pos_employees SET ${peSets.join(", ")} WHERE id = $${peArgs.length}`,
        peArgs,
      );
    }
    const out = await client.query(
      `SELECT pe.*, u.email, u.first_name, u.last_name
         FROM pos_employees pe JOIN users u ON u.id = pe.user_id
        WHERE pe.id = $1`,
      [eid],
    );
    return out.rows[0];
  });

  return NextResponse.json({ employee });
}
