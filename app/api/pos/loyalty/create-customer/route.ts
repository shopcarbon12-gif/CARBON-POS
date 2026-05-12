import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { queueLoyaltyCall } from "@/lib/loyalty-client";

const schema = z.object({
  phone: z.string().min(7).max(40),
  first_name: z.string().min(1).max(120),
  last_name: z.string().max(120).optional().nullable(),
});

/**
 * POST /api/pos/loyalty/create-customer
 *
 * Explicit customer creation from the sell-screen "+" button on the
 * loyalty pending-phone box. Creates a pos_customers row and queues a
 * /api/v1/customers/link call to Carbon-Loyalty so the customer is
 * enrolled in rewards. Returns the new customer.
 *
 * Cashier role is sufficient — this is not the manager-gated full
 * customer CRUD; it's a customer-initiated loyalty enrollment.
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
  const first = parsed.data.first_name.trim();
  const last = (parsed.data.last_name ?? "").trim() || null;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // One more lookup inside the txn so two cashiers racing on the same
    // phone don't create two rows.
    const existing = await client.query(
      `SELECT id, first_name, last_name, email, phone, mobile_phone,
              customer_type, store_credit_balance
         FROM pos_customers
        WHERE regexp_replace(COALESCE(mobile_phone,''), '[^0-9+]', '', 'g') = $1
           OR regexp_replace(COALESCE(phone,''),        '[^0-9+]', '', 'g') = $1
        ORDER BY id ASC LIMIT 1`,
      [phone],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      await client.query("COMMIT");
      return NextResponse.json({ customer: existing.rows[0], was_existing: true });
    }

    const created = await client.query(
      `INSERT INTO pos_customers
         (first_name, last_name, mobile_phone, phone, created_by_user_id, created_via)
       VALUES ($1, $2, $3, $3, $4::uuid, 'pos_reader_prompt')
       RETURNING id, first_name, last_name, email, phone, mobile_phone,
                 customer_type, store_credit_balance`,
      [first, last, phone, cashier.user_id],
    );
    const customer = created.rows[0];

    // Enroll in loyalty (queued so it commits with this txn and the
    // background drainer retries on failure).
    await queueLoyaltyCall(client, "/api/v1/customers/link", {
      customer_id: customer.id,
      phone,
      email: null,
    });

    await client.query("COMMIT");
    return NextResponse.json({ customer, was_existing: false });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[loyalty/create-customer]", err);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
