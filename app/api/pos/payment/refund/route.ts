import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { queueLoyaltyCall } from "@/lib/loyalty-client";
import { currentCashier } from "@/lib/session";
import { moveStoreCredit } from "@/lib/store-credit-ledger";
import {
  priceReturn,
  recordReturnItems,
  restockEpcs,
  ReturnError,
  type ReturnQuote,
} from "@/lib/returns";

const schema = z.object({
  sale_id: z.number().int().positive(),
  /** Only for a price adjustment with no goods coming back (manager+).
   *  When items are returned the server prices them itself. */
  amount: z.number().positive().optional(),
  reason: z.string().max(500).optional(),
  method: z.enum(["original_card", "cash", "store_credit"]),
  /** The pieces coming back: RFID pieces by the EPC scanned on return
   *  (must be a tag sold on that line), untagged pieces by quantity. */
  items: z
    .array(
      z.object({
        line_id: z.number().int().positive(),
        epc: z.string().max(64).nullable().optional(),
        quantity: z.number().int().positive().optional(),
      }),
    )
    .max(500)
    .optional(),
  /** Old whole-line returns — no longer accepted (items must be scanned). */
  line_ids: z.array(z.number().int().positive()).max(200).optional(),
});

/**
 * POST /api/pos/payment/refund
 *
 * Refund flow:
 *   - Lock the sale row and reject (422) any amount above what's still
 *     refundable (sale total − prior pos_refunds) BEFORE touching Stripe.
 *   - For 'original_card': find the most-recent card payment on the sale,
 *     create a Stripe refund against its PaymentIntent.
 *   - For 'cash': no Stripe call; we just record the row.
 *   - For 'store_credit': adds the amount to the sale customer's balance
 *     (pos_store_credit_ledger); rejected when the sale has no customer.
 *   - Returned goods come as `items`: every RFID piece by the EPC scanned
 *     coming back (verified against the tags sold on that line, once
 *     only), untagged pieces by quantity. The server prices them
 *     (lib/returns), records them in pos_refund_items and puts exactly
 *     those tags back in stock. A money-only price adjustment (no items)
 *     is manager/admin only.
 *   - When the sale has a customer, queue /api/v1/refund in the loyalty
 *     outbox (same transaction) so Carbon-Rewards claws back the earned
 *     points and returns redeemed ones, pro-rated by refund / sale total.
 *   - For partial refunds, you can call this multiple times — each call
 *     records a separate pos_refunds row; the sale stays 'completed'
 *     until the full total is refunded.
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
  const { sale_id, reason, method, items, line_ids } = parsed.data;
  if (!items?.length && line_ids?.length) {
    return NextResponse.json(
      {
        error: "scan_required",
        message: "Returned items have to be scanned back in. Use the return screen.",
      },
      { status: 422 },
    );
  }
  if (!items?.length) {
    // Money back with nothing returned (price adjustment) — managers only.
    if (!parsed.data.amount || (cashier.role !== "manager" && cashier.role !== "admin")) {
      return NextResponse.json(
        { error: "items_required", message: "Pick and scan the items being returned." },
        { status: 422 },
      );
    }
  }
  let amount = parsed.data.amount ?? 0;
  let quote: ReturnQuote | null = null;

  // Set inside the transaction once Stripe succeeds, so the db_failed
  // message below can still hand the manager the Stripe refund id.
  let stripeRefundId: string | null = null;
  try {
    const refund = await withTransaction(async (client) => {
      // Over-refund guard. FOR UPDATE serialises concurrent refunds on the
      // same sale, so two tills can't both pass the check. It runs before
      // the Stripe call — a rejected refund never reaches the card.
      const saleRes = await client.query<{
        total_amount: string;
        customer_id: number | null;
        sale_number: string;
      }>(
        `SELECT total_amount, customer_id, sale_number FROM pos_sales WHERE id = $1 FOR UPDATE`,
        [sale_id],
      );
      if (saleRes.rows.length === 0) {
        throw new RefundRejected(404, "sale_not_found", "Sale not found.");
      }
      // Store credit lands on the sale's customer — there must be one.
      if (method === "store_credit" && saleRes.rows[0].customer_id == null) {
        throw new RefundRejected(
          422,
          "store_credit_needs_customer",
          "This sale has no customer attached, so there's no account to put store credit on. Refund as cash or to the card instead.",
        );
      }
      // Price the returned pieces (tags verified against the sale).
      if (items?.length) {
        try {
          quote = await priceReturn(client, {
            lid: cashier.lid,
            saleId: sale_id,
            items,
            lock: true,
          });
        } catch (err) {
          if (err instanceof ReturnError) throw new RefundRejected(422, "return_invalid", err.message);
          throw err;
        }
        amount = quote.credit;
      }

      const priorRes = await client.query<{ refunded: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS refunded
           FROM pos_refunds
          WHERE original_sale_id = $1`,
        [sale_id],
      );
      const remaining =
        Number(saleRes.rows[0].total_amount) - Number(priorRes.rows[0].refunded);
      // Line totals carry per-line tax rounding, so refunding every line can
      // come to a cent or two more than the sale total — refund what's left.
      if (amount > remaining && amount - remaining <= 0.05) {
        amount = Math.round(remaining * 100) / 100;
      }
      if (amount > remaining + 0.005) {
        throw new RefundRejected(
          422,
          "exceeds_refundable",
          `Refund of $${amount.toFixed(2)} is more than the $${Math.max(0, remaining).toFixed(2)} still refundable on this sale.`,
        );
      }

      if (method === "original_card") {
        try {
          stripeRefundId = await refundOriginalCard(client, sale_id, amount);
        } catch (err) {
          console.error("[refund] stripe failed", err);
          throw new RefundRejected(
            502,
            "stripe_failed",
            "Couldn't refund the card. Try again or refund as cash/store credit.",
          );
        }
      }

      // Tie the refund to the register it's paid out of: the refunding
      // cashier's own open session at this store, else any open register
      // here (e.g. a manager refunding from the cashier's drawer). Cash
      // refunds are then subtracted from that session's expected cash.
      const sessRes = await client.query<{ id: number }>(
        `SELECT s.id
           FROM pos_register_sessions s
           JOIN pos_registers r  ON r.id = s.register_id
           JOIN pos_locations pl ON pl.id = r.pos_location_id
          WHERE s.status = 'open'
            AND pl.wms_location_id = $2::uuid
          ORDER BY (s.opened_by = $1::uuid) DESC, s.opened_at DESC
          LIMIT 1`,
        [cashier.user_id, cashier.lid],
      );
      // tax_amount for the Sales Tax report: the returned pieces' tax, or
      // the sale's tax share for a price adjustment.
      const itemsValue = quote ? quote.entries.reduce((x, e) => x + e.amount, 0) : 0;
      const ins = await client.query(
        `INSERT INTO pos_refunds
           (original_sale_id, amount, reason, method, stripe_refund_id,
            refunded_by, register_session_id, line_ids, tax_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 COALESCE($9::numeric,
                   (SELECT CASE WHEN s.total_amount > 0
                                THEN ROUND($2::numeric * s.tax_amount / s.total_amount, 2)
                                ELSE 0 END
                      FROM pos_sales s WHERE s.id = $1)))
         RETURNING *`,
        [
          sale_id,
          amount,
          reason ?? null,
          method,
          stripeRefundId,
          cashier.employee_id,
          sessRes.rows[0]?.id ?? null,
          quote ? quote.lineIds : null,
          quote
            ? itemsValue > 0 && amount < itemsValue - 0.005
              ? Math.round(((quote.tax * amount) / itemsValue) * 100) / 100
              : quote.tax
            : null,
        ],
      );
      if (quote) await recordReturnItems(client, ins.rows[0].id, quote.entries);

      if (method === "store_credit" && saleRes.rows[0].customer_id != null) {
        await moveStoreCredit(client, {
          customerId: saleRes.rows[0].customer_id,
          delta: amount,
          kind: "refund",
          reason: `Refund of ${saleRes.rows[0].sale_number}`,
          saleId: sale_id,
          refundId: ins.rows[0].id,
          employeeId: cashier.employee_id,
        });
      }

      // Mark the sale refunded once the full total has been given back.
      const sumRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded,
                (SELECT total_amount FROM pos_sales WHERE id = $1) AS total,
                (SELECT customer_id FROM pos_sales WHERE id = $1) AS customer_id
           FROM pos_refunds
          WHERE original_sale_id = $1`,
        [sale_id],
      );
      const refunded = Number(sumRes.rows[0].refunded);
      const total = Number(sumRes.rows[0].total);
      const fullyRefunded = refunded >= total - 0.005;
      if (fullyRefunded) {
        await client.query(
          `UPDATE pos_sales SET status = 'refunded' WHERE id = $1`,
          [sale_id],
        );
      }

      // Exactly the scanned tags go back in stock (lib/returns).
      if (quote) {
        await restockEpcs(client, {
          epcs: quote.epcs,
          tenantId: cashier.tid,
          userId: cashier.user_id,
          reason: "pos_refund",
        });
      }

      // Loyalty hook — queue the points reversal in pos_loyalty_outbox so
      // it commits atomically with the refund row. Rewards pro-rates the
      // sale's earn + redemption ledger rows by refund_pct; the key is
      // per pos_refunds row so stacked partial refunds each apply once.
      if (sumRes.rows[0].customer_id != null) {
        const refundPct =
          total > 0 ? Math.min(1, Math.max(0, amount / total)) : 1;
        await queueLoyaltyCall(client, "/api/v1/refund", {
          idempotency_key: `${String(ins.rows[0].id).padStart(8, "0")}-pos-refund`,
          sale_id,
          refund_amount: amount,
          refund_pct: refundPct,
        });
      }
      return ins.rows[0];
    });
    return NextResponse.json({ refund });
  } catch (err) {
    if (err instanceof RefundRejected) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.status },
      );
    }
    console.error("[refund] db failed", err);
    return NextResponse.json(
      {
        error: "db_failed",
        message:
          stripeRefundId
            ? "We refunded the card but couldn't save the record. Tell a manager — Stripe refund id: " +
              stripeRefundId
            : "Couldn't save the refund. Try again.",
      },
      { status: 500 },
    );
  }
}

/** Thrown inside the refund transaction to roll it back and answer with
 *  a specific status — nothing has been written (or refunded) yet. */
class RefundRejected extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function refundOriginalCard(
  client: PoolClient,
  saleId: number,
  amount: number,
): Promise<string> {
  // Pull the latest card payment on this sale.
  const r = await client.query(
    `SELECT stripe_payment_intent_id
       FROM pos_payments
      WHERE sale_id = $1 AND method = 'card' AND status = 'completed'
      ORDER BY processed_at DESC
      LIMIT 1`,
    [saleId],
  );
  const intent = r.rows[0]?.stripe_payment_intent_id;
  if (!intent) throw new Error("no_card_payment_on_sale");
  const refund = await stripe().refunds.create({
    payment_intent: intent,
    amount: Math.round(amount * 100),
  });
  return refund.id;
}
