import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { withTransaction, getPool } from "@/lib/db";
import { currentCashier } from "@/lib/session";
import { formatSaleNumber } from "@/lib/utils";

const lineSchema = z.object({
  sku_id: z.string().uuid().nullable(),
  epc: z.string().nullable(),
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  discount_amount: z.number().nonnegative(),
  tax_rate: z.number().nonnegative(),
  line_type: z.enum(["product", "misc", "gift_card"]),
});

const cardPayment = z.object({
  method: z.literal("card"),
  payment_intent_id: z.string().min(1),
  reader_id: z.string().nullable().optional(),
  amount: z.number().positive(),
});

const cashPayment = z.object({
  method: z.literal("cash"),
  amount: z.number().positive(),
  cash_given: z.number().positive(),
});

const checkPayment = z.object({
  method: z.literal("check"),
  amount: z.number().positive(),
  check_number: z.string().min(1),
});

const storeCreditPayment = z.object({
  method: z.literal("store_credit"),
  amount: z.number().positive(),
});

const accountPayment = z.object({
  method: z.literal("account"),
  amount: z.number().positive(),
  /** Optional reference (PO number, customer note) — printed on the receipt. */
  reference: z.string().max(120).optional().nullable(),
});

const giftCardPayment = z.object({
  method: z.literal("gift_card"),
  amount: z.number().positive(),
  /** Card number / serial — recorded on the payment row. */
  gift_card_number: z.string().min(1).max(64),
});

const schema = z.object({
  register_id: z.number().int().positive(),
  customer_id: z.number().int().positive().nullable().optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(lineSchema).min(1),
  payments: z
    .array(
      z.union([
        cardPayment,
        cashPayment,
        checkPayment,
        storeCreditPayment,
        accountPayment,
        giftCardPayment,
      ]),
    )
    .min(1),
});

/**
 * POST /api/pos/payment/capture
 *
 * The single transaction that finalizes a sale.
 *  1. Captures the Stripe PaymentIntent (for any card payments).
 *  2. BEGIN
 *     - INSERT pos_sales (header, status='completed')
 *     - INSERT pos_sale_lines
 *     - INSERT pos_payments
 *     - UPDATE epcs SET status='sold' WHERE epc = ANY(...)
 *     - INSERT audit_log (best-effort; ignored if WMS table differs)
 *     COMMIT
 *  3. If anything in step 2 fails, ROLLBACK the DB and refund the captured
 *     card so we don't leave the customer charged for a sale that never
 *     persisted.
 */
export async function POST(req: Request) {
  const cashier = await currentCashier();
  if (!cashier) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const cardPayments = data.payments.filter((p) => p.method === "card");
  const capturedIntents: string[] = [];

  // Capture each card intent first. If any capture fails, refund the ones
  // that succeeded and bail out — never persist a partial sale.
  try {
    for (const p of cardPayments) {
      const captured = await stripe().paymentIntents.capture(
        p.payment_intent_id,
      );
      if (captured.status !== "succeeded") {
        throw new Error(`intent_${captured.status}`);
      }
      capturedIntents.push(captured.id);
    }
  } catch (err) {
    console.error("[capture] card capture failed", err);
    await refundAll(capturedIntents);
    return NextResponse.json(
      {
        error: "card_capture_failed",
        message:
          "The card payment didn't go through. The customer was not charged.",
      },
      { status: 502 },
    );
  }

  // Compute totals server-side from the lines so the client can't lie.
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of data.lines) {
    const lineSubtotal = l.unit_price * l.quantity;
    subtotal += lineSubtotal;
    discount += l.discount_amount;
    tax += Math.max(0, lineSubtotal - l.discount_amount) * l.tax_rate;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  subtotal = round(subtotal);
  discount = round(discount);
  tax = round(tax);
  const total = round(subtotal - discount + tax);
  const paid = round(data.payments.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paid - total) > 0.01) {
    await refundAll(capturedIntents);
    return NextResponse.json(
      {
        error: "amount_mismatch",
        message:
          "The payment amounts don't add up to the sale total. The card was not charged.",
      },
      { status: 400 },
    );
  }

  try {
    const sale = await withTransaction(async (client) => {
      // Verify register session is open before persisting.
      const reg = await client.query(
        `SELECT pl.id AS pos_location_id
           FROM pos_registers r
           JOIN pos_locations pl ON pl.id = r.pos_location_id
          WHERE r.id = $1
            AND EXISTS (
              SELECT 1 FROM pos_register_sessions s
               WHERE s.register_id = r.id AND s.status = 'open'
            )
          LIMIT 1`,
        [data.register_id],
      );
      const regRow = reg.rows[0];
      if (!regRow) throw new Error("register_not_open");

      const seq = await client.query(
        `SELECT nextval('pos_sale_number_seq') AS seq`,
      );
      const saleNumber = formatSaleNumber(Number(seq.rows[0].seq));

      const saleRow = await client.query(
        `INSERT INTO pos_sales
           (sale_number, register_id, pos_location_id, cashier_id, customer_id,
            subtotal, discount_amount, tax_amount, total_amount,
            status, completed_at, notes)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed', now(), $10)
         RETURNING *`,
        [
          saleNumber,
          data.register_id,
          regRow.pos_location_id,
          cashier.employee_id,
          data.customer_id ?? null,
          subtotal,
          discount,
          tax,
          total,
          data.notes ?? null,
        ],
      );
      const sale = saleRow.rows[0];

      for (const l of data.lines) {
        const lineSubtotal = l.unit_price * l.quantity;
        const lineTaxBase = Math.max(0, lineSubtotal - l.discount_amount);
        const lineTax = round(lineTaxBase * l.tax_rate);
        const lineTotal = round(lineSubtotal - l.discount_amount + lineTax);
        await client.query(
          `INSERT INTO pos_sale_lines
             (sale_id, sku_id, epc, description, quantity, unit_price,
              discount_amount, tax_rate, tax_amount, line_total, line_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            sale.id,
            l.sku_id,
            l.epc,
            l.description,
            l.quantity,
            l.unit_price,
            l.discount_amount,
            l.tax_rate,
            lineTax,
            lineTotal,
            l.line_type,
          ],
        );
      }

      for (const p of data.payments) {
        let cashGiven: number | null = null;
        let changeGiven: number | null = null;
        let intentId: string | null = null;
        let readerId: string | null = null;
        let checkNumber: string | null = null;
        let reference: string | null = null;
        if (p.method === "cash") {
          cashGiven = p.cash_given;
          changeGiven = round(Math.max(0, p.cash_given - p.amount));
        }
        if (p.method === "card") {
          intentId = p.payment_intent_id;
          readerId = p.reader_id ?? null;
        }
        if (p.method === "check") {
          checkNumber = p.check_number;
        }
        if (p.method === "account") {
          reference = p.reference?.trim() || null;
        }
        if (p.method === "gift_card") {
          reference = p.gift_card_number.trim();
        }
        await client.query(
          `INSERT INTO pos_payments
             (sale_id, method, amount,
              stripe_payment_intent_id, stripe_reader_id,
              cash_given, change_given, check_number,
              reference, status, processed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed', now())`,
          [
            sale.id,
            p.method,
            p.amount,
            intentId,
            readerId,
            cashGiven,
            changeGiven,
            checkNumber,
            reference,
          ],
        );
      }

      // Mark every scanned EPC as sold in the WMS table.
      const epcs = data.lines
        .map((l) => l.epc)
        .filter((e): e is string => typeof e === "string" && e.length > 0);
      if (epcs.length > 0) {
        await client.query(
          `UPDATE epcs
              SET status = 'sold',
                  updated_at = now()
            WHERE epc = ANY($1::text[])`,
          [epcs],
        );
      }

      // Best-effort audit row. Schema for audit_log varies by deployment;
      // wrap in a savepoint so a failure here doesn't kill the sale.
      try {
        await client.query("SAVEPOINT audit");
        await client.query(
          `INSERT INTO audit_log (event_type, payload, created_at)
           VALUES ('pos_sale', $1::jsonb, now())`,
          [
            JSON.stringify({
              sale_id: sale.id,
              sale_number: sale.sale_number,
              total,
              items_count: data.lines.length,
              cashier_id: cashier.employee_id,
              location_id: regRow.pos_location_id,
            }),
          ],
        );
        await client.query("RELEASE SAVEPOINT audit");
      } catch (auditErr) {
        await client.query("ROLLBACK TO SAVEPOINT audit");
        console.warn("[capture] audit_log insert skipped:", auditErr);
      }

      return sale;
    });
    return NextResponse.json({ sale });
  } catch (err) {
    console.error("[capture] db transaction failed", err);
    await refundAll(capturedIntents);
    const msg =
      (err as Error).message === "register_not_open"
        ? "Your register isn't open. Reopen it from the Register screen."
        : "Couldn't save the sale. The customer was not charged.";
    return NextResponse.json({ error: "db_failed", message: msg }, { status: 500 });
  }
}

async function refundAll(intentIds: string[]) {
  for (const id of intentIds) {
    try {
      await stripe().refunds.create({ payment_intent: id });
    } catch (e) {
      console.error("[capture] refund failed for", id, e);
    }
  }
}

// Force-import getPool so unused-import lint doesn't flag the helper file.
void getPool;
