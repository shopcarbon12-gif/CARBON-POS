import type { Pool, PoolClient } from "pg";
import {
  priceReturn,
  recordReturnItems,
  restockEpcs,
  ReturnError,
  type ReturnItemInput,
  type ReturnQuote,
} from "@/lib/returns";
import { moveStoreCredit } from "@/lib/store-credit-ledger";
import { queueLoyaltyCall } from "@/lib/loyalty-client";

/**
 * Exchanges: pieces returned from an earlier sale pay for a new one.
 * The returned pieces are priced and tag-verified by lib/returns.
 */
export { ReturnError as ExchangeError };
export type ExchangeQuote = ReturnQuote;

export function quoteExchange(
  db: Pool | PoolClient,
  a: { saleId: number; items: ReturnItemInput[]; lid: string; lock?: boolean },
): Promise<ExchangeQuote> {
  return priceReturn(db, { lid: a.lid, saleId: a.saleId, items: a.items, lock: a.lock });
}

/**
 * Exchange bookkeeping on the ORIGINAL sale, inside the capture
 * transaction: a refund row (method 'exchange') for the credit applied to
 * the new sale, a cash / store-credit refund row for any difference given
 * back, the returned pieces (pos_refund_items), restock of exactly the
 * scanned tags, sale status, and the loyalty points reversal.
 */
export async function recordExchangeReturn(
  client: PoolClient,
  a: {
    quote: ExchangeQuote;
    items: ReturnItemInput[];
    lid: string;
    newSale: { id: number; number: string };
    creditApplied: number;
    overage: number;
    /** store_credit (policy) or, with an approved override, back to the
     *  original payment (card if the sale had one, else cash). */
    payout: "store_credit" | "original" | null;
    payoutApprovedBy?: string | null;
    customerId: number | null;
    cashier: { employee_id: number; tid: string; user_id: string };
    registerId: number;
  },
): Promise<{ refundId: number; amount: number; intent: string } | null> {
  // Final check under a row lock: nothing about the return changed since
  // the quote (e.g. the same piece returned on another register).
  const locked = await quoteExchange(client, {
    saleId: a.quote.saleId,
    items: a.items,
    lid: a.lid,
    lock: true,
  });
  if (Math.abs(locked.credit - a.quote.credit) > 0.009) {
    throw new ReturnError("The returned items changed while this sale was being paid.");
  }
  const session = await client.query<{ id: number }>(
    `SELECT id FROM pos_register_sessions WHERE register_id = $1 AND status = 'open' LIMIT 1`,
    [a.registerId],
  );
  const sessionId = session.rows[0]?.id ?? null;
  const taxShare = (amt: number) =>
    locked.credit > 0 ? Math.round(((amt * locked.tax) / locked.credit) * 100) / 100 : 0;
  const reason = `Exchanged for ${a.newSale.number}`;

  // Original payment for an approved payout: the sale's card if it had
  // one (refunded at Stripe after commit by the caller), else cash.
  let cardIntent: string | null = null;
  if (a.payout === "original") {
    const card = await client.query<{ stripe_payment_intent_id: string | null }>(
      `SELECT stripe_payment_intent_id FROM pos_payments
        WHERE sale_id = $1 AND method = 'card' AND status = 'completed'
          AND stripe_payment_intent_id IS NOT NULL
        ORDER BY processed_at DESC LIMIT 1`,
      [locked.saleId],
    );
    cardIntent = card.rows[0]?.stripe_payment_intent_id ?? null;
  }
  const payoutMethod =
    a.payout === "original" ? (cardIntent ? "original_card" : "cash") : a.payout;
  let cardPayout: { refundId: number; amount: number; intent: string } | null = null;

  const rows: Array<{ method: string; amount: number }> = [];
  if (a.creditApplied > 0) rows.push({ method: "exchange", amount: a.creditApplied });
  if (a.overage > 0 && payoutMethod) rows.push({ method: payoutMethod, amount: a.overage });
  let firstRefundId: number | null = null;
  for (const [i, r] of rows.entries()) {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO pos_refunds
         (original_sale_id, amount, reason, method, refunded_by,
          register_session_id, line_ids, tax_amount, exchange_sale_id, override_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        locked.saleId,
        r.amount,
        reason,
        r.method,
        a.cashier.employee_id,
        sessionId,
        i === 0 ? locked.lineIds : null,
        taxShare(r.amount),
        a.newSale.id,
        i > 0 && a.payout === "original" ? (a.payoutApprovedBy ?? null) : null,
      ],
    );
    if (r.method === "original_card" && cardIntent) {
      cardPayout = { refundId: ins.rows[0].id, amount: r.amount, intent: cardIntent };
    }
    if (i === 0) {
      firstRefundId = ins.rows[0].id;
      // The returned pieces live on one row.
      await recordReturnItems(client, ins.rows[0].id, locked.entries);
    }
    if (r.method === "store_credit" && a.customerId) {
      await moveStoreCredit(client, {
        customerId: a.customerId,
        delta: r.amount,
        kind: "exchange",
        reason: `Exchange difference — ${locked.saleNumber} → ${a.newSale.number}`,
        saleId: a.newSale.id,
        refundId: ins.rows[0].id,
        employeeId: a.cashier.employee_id,
      });
    }
  }

  if (locked.fullyRefunded) {
    await client.query(`UPDATE pos_sales SET status = 'refunded' WHERE id = $1`, [locked.saleId]);
  }
  await restockEpcs(client, {
    epcs: locked.epcs,
    tenantId: a.cashier.tid,
    userId: a.cashier.user_id,
    reason: "pos_exchange",
  });

  // Same points reversal a refund queues; the new sale earns separately.
  if (locked.customerId != null && firstRefundId != null) {
    const pct = locked.saleTotal > 0 ? Math.min(1, locked.credit / locked.saleTotal) : 1;
    await queueLoyaltyCall(client, "/api/v1/refund", {
      idempotency_key: `${String(firstRefundId).padStart(8, "0")}-pos-refund`,
      sale_id: locked.saleId,
      refund_amount: locked.credit,
      refund_pct: pct,
    });
  }
  return cardPayout;
}
