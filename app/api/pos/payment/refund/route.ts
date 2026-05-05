import { NextResponse } from "next/server";
import { z } from "zod";
import { stripe } from "@/lib/stripe-terminal";
import { withTransaction } from "@/lib/db";
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
 *     sale back to 'in_stock' inside the same transaction.
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
      const ins = await client.query(
        `INSERT INTO pos_refunds
           (original_sale_id, amount, reason, method, stripe_refund_id, refunded_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          sale_id,
          amount,
          reason ?? null,
          method,
          stripeRefundId,
          cashier.employee_id,
        ],
      );

      // Reverse EPCs: any tag captured on the original sale lines flips back
      // to 'in_stock'. (Phase 2 narrows this to only the returned lines.)
      const epcRes = await client.query(
        `SELECT epc FROM pos_sale_lines
          WHERE sale_id = $1 AND epc IS NOT NULL`,
        [sale_id],
      );
      const epcs = epcRes.rows.map((r) => r.epc as string);
      if (epcs.length > 0) {
        await client.query(
          `UPDATE epcs SET status = 'in_stock', updated_at = now()
            WHERE epc = ANY($1::text[])`,
          [epcs],
        );
      }

      // Mark sale refunded if we just refunded the full total.
      const sumRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded,
                (SELECT total_amount FROM pos_sales WHERE id = $1) AS total
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
