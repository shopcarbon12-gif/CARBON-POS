import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const customerInput = z.object({
  customer_type: z
    .enum(["regular", "vip", "staff", "wholesale"])
    .optional(),
  first_name: z.string().min(1).max(120),
  last_name: z.string().max(120).optional().nullable(),
  company: z.string().max(256).optional().nullable(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  home_phone: z.string().max(40).optional().nullable(),
  work_phone: z.string().max(40).optional().nullable(),
  mobile_phone: z.string().max(40).optional().nullable(),
  /** Legacy single phone field — POST allows it for back-compat callers. */
  phone: z.string().max(40).optional().nullable(),
  email: z.string().email().max(256).optional().nullable(),
  email_2: z.string().email().max(256).optional().nullable(),
  country: z.string().max(64).optional().nullable(),
  address_line1: z.string().max(256).optional().nullable(),
  address_line2: z.string().max(256).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  state: z.string().max(64).optional().nullable(),
  zip: z.string().max(32).optional().nullable(),
  tags: z.array(z.string().max(64)).max(32).optional(),
  contact_consent: z.boolean().optional(),
  contact_email_ok: z.boolean().optional(),
  contact_mail_ok: z.boolean().optional(),
  contact_call_ok: z.boolean().optional(),
  pos_location_id: z.number().int().positive().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * GET  /api/pos/customers?q=…    — search/list (top 50)
 * POST /api/pos/customers        — create. The active cashier's user_id is
 *                                   stamped onto pos_customers.created_by_user_id
 *                                   so the edit page can show "Created by".
 */
export async function GET(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const pool = getPool();
  const args: unknown[] = [];
  let where = "";
  if (q.length > 0) {
    args.push(`%${q}%`);
    where = `WHERE first_name ILIKE $1
             OR last_name ILIKE $1
             OR email ILIKE $1
             OR phone ILIKE $1
             OR mobile_phone ILIKE $1`;
  }
  const r = await pool.query(
    `SELECT id, first_name, last_name, email, phone, mobile_phone,
            customer_type, store_credit_balance, created_at
       FROM pos_customers
       ${where}
      ORDER BY last_name NULLS LAST, first_name
      LIMIT 50`,
    args,
  );
  return NextResponse.json({ customers: r.rows });
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier || (cashier.role !== "manager" && cashier.role !== "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = customerInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  // The legacy `phone` column is still read by sale receipts. Mirror the
  // mobile number into it on insert so older code paths keep working.
  const legacyPhone = d.phone ?? d.mobile_phone ?? null;
  const pool = getPool();
  const r = await pool.query(
    `INSERT INTO pos_customers
       (first_name, last_name, company, birthday,
        email, email_2, phone, home_phone, work_phone, mobile_phone,
        country, address_line1, address_line2, city, state, zip,
        tags, contact_consent, contact_email_ok, contact_mail_ok, contact_call_ok,
        customer_type, pos_location_id, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,
             $5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,
             $22,$23,$24,$25::uuid)
     RETURNING *`,
    [
      d.first_name,
      d.last_name ?? null,
      d.company ?? null,
      d.birthday ?? null,
      d.email ?? null,
      d.email_2 ?? null,
      legacyPhone,
      d.home_phone ?? null,
      d.work_phone ?? null,
      d.mobile_phone ?? null,
      d.country ?? null,
      d.address_line1 ?? null,
      d.address_line2 ?? null,
      d.city ?? null,
      d.state ?? null,
      d.zip ?? null,
      d.tags ?? [],
      d.contact_consent ?? false,
      d.contact_email_ok ?? false,
      d.contact_mail_ok ?? false,
      d.contact_call_ok ?? false,
      d.customer_type ?? "regular",
      d.pos_location_id ?? null,
      d.notes ?? null,
      cashier.user_id,
    ],
  );
  return NextResponse.json({ customer: r.rows[0] });
}
