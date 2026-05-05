import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const patchSchema = z.object({
  first_name: z.string().min(1).max(120).optional(),
  last_name: z.string().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  customer_type: z
    .enum(["regular", "vip", "staff", "wholesale"])
    .optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const pool = getPool();
  const r = await pool.query(
    `SELECT * FROM pos_customers WHERE id = $1`,
    [cid],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ customer: r.rows[0] });
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
  const cid = Number(id);
  if (!Number.isFinite(cid)) {
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
  const fields = parsed.data as Record<string, unknown>;
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const k of Object.keys(fields)) {
    args.push(fields[k]);
    sets.push(`${k} = $${args.length}`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }
  args.push(cid);
  const pool = getPool();
  const r = await pool.query(
    `UPDATE pos_customers SET ${sets.join(", ")}
       WHERE id = $${args.length}
       RETURNING *`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ customer: r.rows[0] });
}
