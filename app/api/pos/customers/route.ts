import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const customerInput = z.object({
  first_name: z.string().min(1).max(120),
  last_name: z.string().max(120).optional().nullable(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** Phone 1 (primary) — still the `phone` column. */
  phone: z.string().max(40).optional().nullable(),
  /** Phone 2 (secondary). */
  phone_2: z.string().max(40).optional().nullable(),
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
             OR email_2 ILIKE $1
             OR phone ILIKE $1
             OR phone_2 ILIKE $1`;
  }
  const r = await pool.query(
    `SELECT id, first_name, last_name, email, email_2, phone, phone_2,
            store_credit_balance, created_at
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
  const pool = getPool();
  // Stamp the store the customer was created at: use an explicit
  // pos_location_id if one was passed, else resolve the cashier's signed-in
  // location (session carries the WMS location UUID) to its pos_locations row.
  let posLocationId = d.pos_location_id ?? null;
  if (posLocationId == null && cashier.lid) {
    const lr = await pool.query<{ id: number }>(
      `SELECT id FROM pos_locations WHERE wms_location_id = $1::uuid LIMIT 1`,
      [cashier.lid],
    );
    posLocationId = lr.rows[0]?.id ?? null;
  }
  const r = await pool.query(
    `INSERT INTO pos_customers
       (first_name, last_name, birthday,
        email, email_2, phone, phone_2,
        country, address_line1, address_line2, city, state, zip,
        tags, contact_consent, contact_email_ok, contact_mail_ok, contact_call_ok,
        pos_location_id, notes, created_by_user_id, created_via)
     VALUES ($1,$2,$3,
             $4,$5,$6,$7,
             $8,$9,$10,$11,$12,$13,
             $14,$15,$16,$17,$18,
             $19,$20,$21::uuid,'pos')
     RETURNING *`,
    [
      d.first_name,
      d.last_name ?? null,
      d.birthday ?? null,
      d.email ?? null,
      d.email_2 ?? null,
      d.phone ?? null,
      d.phone_2 ?? null,
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
      posLocationId,
      d.notes ?? null,
      cashier.user_id,
    ],
  );
  return NextResponse.json({ customer: r.rows[0] });
}
