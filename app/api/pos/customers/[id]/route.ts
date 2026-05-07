import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const patchSchema = z.object({
  customer_type: z
    .enum(["regular", "vip", "staff", "wholesale"])
    .optional(),
  first_name: z.string().min(1).max(120).optional(),
  last_name: z.string().max(120).nullable().optional(),
  company: z.string().max(256).nullable().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  home_phone: z.string().max(40).nullable().optional(),
  work_phone: z.string().max(40).nullable().optional(),
  mobile_phone: z.string().max(40).nullable().optional(),
  /** Legacy single phone field — kept on PATCH for back-compat callers. */
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().max(256).nullable().optional(),
  email_2: z.string().email().max(256).nullable().optional(),
  country: z.string().max(64).nullable().optional(),
  address_line1: z.string().max(256).nullable().optional(),
  address_line2: z.string().max(256).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(64).nullable().optional(),
  zip: z.string().max(32).nullable().optional(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  contact_consent: z.boolean().optional(),
  contact_email_ok: z.boolean().optional(),
  contact_mail_ok: z.boolean().optional(),
  contact_call_ok: z.boolean().optional(),
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
    `SELECT pc.*, u.email AS created_by_email
       FROM pos_customers pc
       LEFT JOIN users u ON u.id = pc.created_by_user_id
      WHERE pc.id = $1`,
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

  // Mirror mobile_phone into the legacy `phone` column when the caller
  // didn't pass one explicitly so downstream readers (receipts etc.) keep
  // working with the new mobile-only form.
  if (
    !Object.prototype.hasOwnProperty.call(fields, "phone") &&
    Object.prototype.hasOwnProperty.call(fields, "mobile_phone")
  ) {
    fields.phone = fields.mobile_phone;
  }

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
