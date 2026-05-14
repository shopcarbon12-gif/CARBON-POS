import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { queueLoyaltyCall } from "@/lib/loyalty-client";
import { validateEmail } from "@/lib/email-validate";

const schema = z.object({
  phone: z.string().min(7).max(40),
  first_name: z.string().min(1).max(120),
  last_name: z.string().max(120).optional().nullable(),
  email: z.string().max(256).optional().nullable(),
});

/**
 * POST /api/pos/loyalty/create-customer
 *
 * Explicit customer creation from the loyalty pending-phone flow.
 * Accepts first/last/optional-email along with the phone captured on
 * the reader. Validates the email if provided and returns a shaped,
 * human-readable error the cashier can read to the customer.
 *
 * Errors surface as 400 with { error: code, message: text }:
 *   - email_format     "That email doesn't look valid…"
 *   - email_duplicate  "That email is already in use by another customer."
 *   - missing_name     "First name is required."
 *
 * The route also serves the same "auto-create on reader completion"
 * path: the SellScreen's reader-prompt-status handler fires this with
 * whatever the customer typed on the pin pad.
 */

function normalizePhone(p: string): string {
  return p.replace(/[^\d+]/g, "");
}

/** Title-case a name (matches lib/utils#capitalizeName). Server-side
 *  defense so the saved row is consistent regardless of UI source. */
function capitalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "Phone and first name are required.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }
  const phone = normalizePhone(parsed.data.phone);
  const first = capitalizeName(parsed.data.first_name.trim());
  const lastRaw = (parsed.data.last_name ?? "").trim();
  const last = lastRaw.length > 0 ? capitalizeName(lastRaw) : null;
  const emailRaw = (parsed.data.email ?? "").trim();
  let email: string | null = null;
  if (emailRaw.length > 0) {
    const check = await validateEmail(emailRaw);
    if (!check.ok) {
      return NextResponse.json(
        { error: check.code === "format" ? "email_format" : `email_${check.code}`, message: check.message },
        { status: 400 },
      );
    }
    email = check.email;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Phone-race check inside the txn.
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

    // Email uniqueness check (only if email was provided).
    if (email !== null) {
      const dup = await client.query<{
        id: number;
        first_name: string;
        last_name: string | null;
      }>(
        `SELECT id, first_name, last_name
           FROM pos_customers
          WHERE LOWER(email) = $1
          LIMIT 1`,
        [email],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        await client.query("ROLLBACK");
        const r = dup.rows[0];
        const who = [r.first_name, r.last_name].filter(Boolean).join(" ") || "another customer";
        return NextResponse.json(
          {
            error: "email_duplicate",
            message:
              `That email is already on file for ${who} (#${r.id}). Please use a different email or attach that customer instead.`,
            duplicate_customer_id: r.id,
          },
          { status: 400 },
        );
      }
    }

    // created_via must satisfy pos_customers_created_via_check, which
    // limits the value to: pos | shopify | wms_manual | wms_csv | admin
    // | legacy. The previous 'pos_reader_prompt' literal was rejected
    // by that constraint and every customer creation (both the cashier
    // form path AND the pinpad reader-name-prompt path) was 500-ing
    // with "violates check constraint pos_customers_created_via_check"
    // — operator saw "Couldn't create the customer record" every time.
    const created = await client.query(
      `INSERT INTO pos_customers
         (first_name, last_name, email, mobile_phone, phone,
          contact_email_ok, created_by_user_id, created_via)
       VALUES ($1, $2, $3, $4, $4,
               $5, $6::uuid, 'pos')
       RETURNING id, first_name, last_name, email, phone, mobile_phone,
                 customer_type, store_credit_balance`,
      [first, last, email, phone, email !== null, cashier.user_id],
    );
    const customer = created.rows[0];

    await queueLoyaltyCall(client, "/api/v1/customers/link", {
      customer_id: customer.id,
      phone,
      email,
    });

    await client.query("COMMIT");
    return NextResponse.json({ customer, was_existing: false });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[loyalty/create-customer]", err);
    return NextResponse.json(
      {
        error: "create_failed",
        message:
          "Couldn't create the customer record. Try again, or attach an existing customer.",
        detail: (err as Error).message,
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
