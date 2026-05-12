import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  phone: z.string().min(7).max(40),
});

/**
 * POST /api/pos/loyalty/lookup
 *
 * Takes a phone number collected on the reader and returns the matching
 * pos_customers row if one exists. Never creates — the cashier confirms
 * creation explicitly via /api/pos/loyalty/create-customer with the "+"
 * button on the sell screen.
 *
 *   { found: true,  customer: {...} }                      — existing
 *   { found: false, phone: "<normalized>" }                — no match
 */
function normalizePhone(p: string): string {
  return p.replace(/[^\d+]/g, "");
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const phone = normalizePhone(parsed.data.phone);

  const pool = getPool();
  const hit = await pool.query(
    `SELECT id, first_name, last_name, email, phone, mobile_phone,
            customer_type, store_credit_balance
       FROM pos_customers
      WHERE regexp_replace(COALESCE(mobile_phone,''), '[^0-9+]', '', 'g') = $1
         OR regexp_replace(COALESCE(phone,''),        '[^0-9+]', '', 'g') = $1
         OR regexp_replace(COALESCE(home_phone,''),   '[^0-9+]', '', 'g') = $1
         OR regexp_replace(COALESCE(work_phone,''),   '[^0-9+]', '', 'g') = $1
      ORDER BY id ASC
      LIMIT 1`,
    [phone],
  );
  if (hit.rowCount && hit.rowCount > 0) {
    return NextResponse.json({ found: true, customer: hit.rows[0] });
  }
  return NextResponse.json({ found: false, phone });
}
