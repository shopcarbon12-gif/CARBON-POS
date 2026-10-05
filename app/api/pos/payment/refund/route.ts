import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { withTransaction } from "@/lib/db";
import { queueLoyaltyCall } from "@/lib/loyalty-client";
import { currentCashier } from "@/lib/session";

const schema = z.object({
  sale_id: z.number().int().positive(),
  amount: z.number().positive(),
  reason: z.string().max(500).optional(),
  method: z.enum(["original_card", "cash", "store_credit"]),
});

/**
 * POST /api/pos/payment/refund
 *
 * Refund flow:
 *   - For 'original_card': find the most-recent card payment on the sale,
 *     create a Stripe refund against its PaymentIntent.
 *   - For 'cash' / 'store_credit': no Stripe call; we just record the row.
 *   - In all cases, write a pos_refunds row and reverse any EPCs on the
 *     sale back to 'in-stock' inside the same transaction.
 *   - When the sale has a customer, queue /api/v1/refund in the loyalty
 *     outbox (same transaction) so Carbon-Rewards claws back the earned
 *     points and returns redeemed ones, pro-rated by refund / sale total.
 *   - For partial refunds, you can call this multiple times — each call
 *     records a separate pos_refunds row but the sale stays in
 *     status='completed' until all the lines are returned. Phase 2 will
 *     add per-line refunds.
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
  const { sale_id, amount, reason, method } = parsed.data;

  let stripeRefundId: string | null = null;
  if (method === "original_card") {
    try {
      stripeRefundId = await refundOriginalCard(sale_id, amount);
    } catch (err) {
      console.error("[refund] stripe failed", err);
      return NextResponse.json(
        {
          error: "stripe_failed",
          message:
            "Couldn't refund the card. Try again or refund as cash/store credit.",
        },
        { status: 502 },
      );
    }
  }

  try {
    const refund = await withTransaction(async (client) => {
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
        `INSERT INTO pos_refunds
           (original_sale_id, amount, reason, method, stripe_refund_id,
            refunded_by, register_session_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          sale_id,
          amount,
          reason ?? null,
          method,
          stripeRefundId,
          cashier.employee_id,
          sessRes.rows[0]?.id ?? null,
        ],
      );

      // Reverse EPCs: any tag captured on the original sale lines flips back
      // to 'in-stock'. (Phase 2 narrows this to only the returned lines.)
      // WMS unified the legacy `epcs` table into `items` (see capture) —
      // the old `UPDATE epcs` hit a non-existent relation and failed every
      // refund on an RFID sale. Mirror capture: flip only rows still 'sold'
      // and log one STATUS_CHANGE per flipped EPC.
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

      // Mark sale refunded if we just refunded the full total.
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
      }

      // Loyalty hook — queue the points reversal in pos_loyalty_outbox so
      // it commits atomically with the refund row. Rewards pro-rates the
      // sale's earn + redemption ledger rows by refund_pct; the key is
      // per pos_refunds row so stacked partial refunds each apply once.
      // The zero-padded id goes FIRST: Rewards builds the ledger
      // source_ref from the key's first 8 chars, so a shared prefix would
      // make every later partial refund collide and silently no-op.
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

async function refundOriginalCard(
  saleId: number,
  amount: number,
): Promise<string> {
  // Pull the latest card payment on this sale.
  const { getPool } = await import("@/lib/db");
  const pool = getPool();
  const r = await pool.query(
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
