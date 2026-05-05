import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const patchSchema = z.object({
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
  const sets: string[] = [];
  const args: unknown[] = [];
  if (parsed.data.role !== undefined) {
    args.push(parsed.data.role);
    sets.push(`role = $${args.length}`);
  }
  if (parsed.data.is_active !== undefined) {
    args.push(parsed.data.is_active);
    sets.push(`is_active = $${args.length}`);
  }
  if (parsed.data.pin !== undefined) {
    const newHash = await bcrypt.hash(parsed.data.pin, 10);
    args.push(newHash);
    sets.push(`pin_hash = $${args.length}`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }
  args.push(eid);
  const pool = getPool();
  const r = await pool.query(
    `UPDATE pos_employees SET ${sets.join(", ")}
       WHERE id = $${args.length}
       RETURNING *`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ employee: r.rows[0] });
}
