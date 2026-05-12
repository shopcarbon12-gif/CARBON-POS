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
 * pos_customers row, or creates a placeholder row if none exists.
 *
 *   { found: true,  is_new: false, customer: {...} }   — existing match
 *   { found: false, is_new: true,  customer: {...} }   — auto-created
 *
 * In the auto-create case, first_name is the placeholder "Loyalty Guest"
 * (the cashier UI immediately prompts for the real name). Cashier role
 * is sufficient here — this is a customer-driven flow, not a
 * cashier-driven CRUD, so we don't require the manager-gated POST.
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
    return NextResponse.json({
      found: true,
      is_new: false,
      customer: hit.rows[0],
    });
  }

  // Create a placeholder customer so the sale can be attached. The
  // cashier's inline name prompt will PATCH this row with real first/last
  // name (or be skipped).
  const created = await pool.query(
    `INSERT INTO pos_customers (first_name, mobile_phone, phone, created_by_user_id, created_via)
     VALUES ('Loyalty Guest', $1, $1, $2::uuid, 'pos_reader_prompt')
     RETURNING id, first_name, last_name, email, phone, mobile_phone,
               customer_type, store_credit_balance`,
    [phone, cashier.user_id],
  );
  return NextResponse.json({
    found: false,
    is_new: true,
    customer: created.rows[0],
  });
}
