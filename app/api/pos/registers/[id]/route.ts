import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
  stripe_reader_id: z.string().nullable().optional(),
  stripe_reader_label: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isFinite(rid)) {
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
  args.push(rid);
  const pool = getPool();
  const r = await pool.query(
    `UPDATE pos_registers SET ${sets.join(", ")}
       WHERE id = $${args.length}
       RETURNING *`,
    args,
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ register: r.rows[0] });
}
