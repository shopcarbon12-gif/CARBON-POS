import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { queueLoyaltyCall } from "@/lib/loyalty-client";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  sale_id: z.number().int().positive(),
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
  method: z.enum(["original_card", "cash", "store_credit"]),
  /** pos_sale_lines ids being returned — printed on the refund receipt. */
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
 *   - For 'cash' / 'store_credit': no Stripe call; we just record the row.
 *   - In all cases, write a pos_refunds row inside the same transaction.
 *     RFID tags on the sale flip back to 'in-stock' only when this refund
 *     takes the sale to fully refunded.
 *   - When the sale has a customer, queue /api/v1/refund in the loyalty
 *     outbox (same transaction) so Carbon-Rewards claws back the earned
 *     points and returns redeemed ones, pro-rated by refund / sale total.
 *   - For partial refunds, you can call this multiple times — each call
 *     records a separate pos_refunds row but the sale stays in
 *     status='completed' (and its inventory stays 'sold') until the full
 *     total is refunded. Phase 2 will add per-line refunds.
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
  const { sale_id, reason, method, line_ids } = parsed.data;
  let amount = parsed.data.amount;

  // Set inside the transaction once Stripe succeeds, so the db_failed
  // message below can still hand the manager the Stripe refund id.
  let stripeRefundId: string | null = null;
  try {
    const refund = await withTransaction(async (client) => {
      // Over-refund guard. FOR UPDATE serialises concurrent refunds on the
      // same sale, so two tills can't both pass the check. It runs before
      // the Stripe call — a rejected refund never reaches the card.
      const saleRes = await client.query<{ total_amount: string }>(
        `SELECT total_amount FROM pos_sales WHERE id = $1 FOR UPDATE`,
        [sale_id],
      );
      if (saleRes.rows.length === 0) {
        throw new RefundRejected(404, "sale_not_found", "Sale not found.");
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
      const ins = await client.query(
        // tax_amount: the refunded share of the sale's tax, recorded for
        // the Sales Tax report (refunds are whole-amount, not per line).
        `INSERT INTO pos_refunds
           (original_sale_id, amount, reason, method, stripe_refund_id,
            refunded_by, register_session_id, line_ids, tax_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
                 ARRAY(SELECT id FROM pos_sale_lines
                        WHERE sale_id = $1 AND id = ANY($8::int[]) ORDER BY id),
                 (SELECT CASE WHEN s.total_amount > 0
                              THEN ROUND($2::numeric * s.tax_amount / s.total_amount, 2)
                              ELSE 0 END
                    FROM pos_sales s WHERE s.id = $1))
         RETURNING *`,
        [
          sale_id,
          amount,
          reason ?? null,
          method,
          stripeRefundId,
          cashier.employee_id,
          sessRes.rows[0]?.id ?? null,
          line_ids ?? [],
        ],
      );

      // Mark sale refunded (and restock its RFID tags) if we just refunded
      // the full total.
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
      if (refunded >= total - 0.005) {
        await client.query(
          `UPDATE pos_sales SET status = 'refunded' WHERE id = $1`,
          [sale_id],
        );

        // Reverse EPCs: the sale is now fully refunded, so every tag
        // captured on its lines flips back to 'in-stock'. Partial refunds
        // only carry an amount, not lines, so they can't tell which pieces
        // came back — they leave inventory alone and staff restock the
        // returned pieces in WMS until line-level returns exist.
        // WMS unified the legacy `epcs` table into `items` (see capture).
        // Mirror capture: flip only rows still 'sold' and log one
        // STATUS_CHANGE per flipped EPC.
        const epcRes = await client.query(
          `SELECT epc FROM pos_sale_lines
            WHERE sale_id = $1 AND epc IS NOT NULL`,
          [sale_id],
        );
        const epcs = epcRes.rows.map((r) => r.epc as string);
        if (epcs.length > 0) {
          const flipped = await client.query<{ epc: string; old_status: string }>(
            `WITH prev AS (
               SELECT epc, status AS old_status
                 FROM items
                WHERE epc = ANY($1::text[])
             )
             UPDATE items i
                SET status = 'in-stock'
               FROM prev p
              WHERE i.epc = p.epc
                AND i.status = 'sold'
             RETURNING i.epc, p.old_status`,
            [epcs],
          );
          for (const r of flipped.rows) {
            await client.query(
              `INSERT INTO inventory_audit_logs
                 (tenant_id, log_type, entity_type, entity_reference,
                  old_value, new_value, reason, user_id, user_uuid)
               VALUES ($1::uuid, 'STATUS_CHANGE', 'EPC', $2, $3, 'in-stock',
                       'pos_refund', NULL, $4::uuid)`,
              [cashier.tid, r.epc, r.old_status, cashier.user_id],
            );
          }
        }
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
