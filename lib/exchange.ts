import type { Pool, PoolClient } from "pg";
import { alreadyReturnedLines, restockReturnedLines } from "@/lib/returns";
import { moveStoreCredit } from "@/lib/store-credit-ledger";
import { queueLoyaltyCall } from "@/lib/loyalty-client";

export class ExchangeError extends Error {}

export type ExchangeQuote = {
  saleId: number;
  saleNumber: string;
  saleTotal: number;
  saleTax: number;
  customerId: number | null;
  lineIds: number[];
  /** Value of the returned items, capped at what's still refundable. */
  credit: number;
  /** Original sale fully refunded once this credit is applied. */
  fullyRefunded: boolean;
};

/**
 * Value the items coming back on an exchange. Validates the original
 * sale is at this store and sold, the lines belong to it, aren't loyalty
 * lines and weren't already returned; caps the credit at what's still
 * refundable. Pass a transaction client + lock=true for the final check.
 */
export async function quoteExchange(
  db: Pool | PoolClient,
  a: { saleId: number; lineIds: number[]; lid: string; lock?: boolean },
): Promise<ExchangeQuote> {
  const s = await db.query(
    `SELECT s.id, s.sale_number, s.total_amount, s.tax_amount, s.customer_id, s.status
       FROM pos_sales s
       JOIN pos_locations pl ON pl.id = s.pos_location_id
      WHERE s.id = $1 AND pl.wms_location_id = $2::uuid
      ${a.lock ? "FOR UPDATE OF s" : ""}`,
    [a.saleId, a.lid],
  );
  const sale = s.rows[0];
  if (!sale) throw new ExchangeError("The original sale wasn't found at this store.");
  if (sale.status !== "completed" && sale.status !== "refunded") {
    throw new ExchangeError("That sale can't be exchanged (it was voided).");
  }
  const ids = [...new Set(a.lineIds)];
  const lines = await db.query<{ id: number; line_total: string; line_type: string }>(
    `SELECT id, line_total, line_type FROM pos_sale_lines
      WHERE sale_id = $1 AND id = ANY($2::int[])`,
    [a.saleId, ids],
  );
  if (lines.rows.length !== ids.length || lines.rows.some((l) => l.line_type === "loyalty_redemption")) {
    throw new ExchangeError("Some of the items being returned aren't on that sale.");
  }
  const already = await alreadyReturnedLines(db as PoolClient, a.saleId);
  if (ids.some((id) => already.has(id))) {
    throw new ExchangeError("One or more of those items were already returned.");
  }
  const prior = await db.query<{ refunded: string }>(
    `SELECT COALESCE(SUM(amount),0) AS refunded FROM pos_refunds WHERE original_sale_id = $1`,
    [a.saleId],
  );
  const total = Number(sale.total_amount);
  const remaining = Math.max(0, total - Number(prior.rows[0].refunded));
  const value = lines.rows.reduce((x, l) => x + Number(l.line_total), 0);
  const credit = Math.round(Math.min(value, remaining) * 100) / 100;
  if (credit <= 0) throw new ExchangeError("Nothing is left to refund on that sale.");
  return {
    saleId: sale.id,
    saleNumber: sale.sale_number,
    saleTotal: total,
    saleTax: Number(sale.tax_amount),
    customerId: sale.customer_id ?? null,
    lineIds: ids,
    credit,
    fullyRefunded: credit >= remaining - 0.005,
  };
}

/**
 * Exchange bookkeeping on the ORIGINAL sale, inside the capture
 * transaction: a refund row (method 'exchange') for the credit applied to
 * the new sale, a cash / store-credit refund row for any difference given
 * back, restock of the returned pieces, sale status, and the loyalty
 * points reversal.
 */
export async function recordExchangeReturn(
  client: PoolClient,
  a: {
    quote: ExchangeQuote;
    lid: string;
    newSale: { id: number; number: string };
    creditApplied: number;
    overage: number;
    payout: "cash" | "store_credit" | null;
    customerId: number | null;
    cashier: { employee_id: number; tid: string; user_id: string };
    registerId: number;
  },
) {
  // Final check under a row lock: nothing about the return changed since
  // the quote (e.g. the same items returned on another register).
  const locked = await quoteExchange(client, {
    saleId: a.quote.saleId,
    lineIds: a.quote.lineIds,
    lid: a.lid,
    lock: true,
  });
  if (Math.abs(locked.credit - a.quote.credit) > 0.009) {
    throw new ExchangeError("The returned items changed while this sale was being paid.");
  }
  const session = await client.query<{ id: number }>(
    `SELECT id FROM pos_register_sessions WHERE register_id = $1 AND status = 'open' LIMIT 1`,
    [a.registerId],
  );
  const sessionId = session.rows[0]?.id ?? null;
  const taxShare = (amt: number) =>
    a.quote.saleTotal > 0 ? Math.round(((amt * a.quote.saleTax) / a.quote.saleTotal) * 100) / 100 : 0;
  const reason = `Exchanged for ${a.newSale.number}`;

  const rows: Array<{ method: string; amount: number }> = [];
  if (a.creditApplied > 0) rows.push({ method: "exchange", amount: a.creditApplied });
  if (a.overage > 0 && a.payout) rows.push({ method: a.payout, amount: a.overage });
  let firstRefundId: number | null = null;
  for (const [i, r] of rows.entries()) {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO pos_refunds
         (original_sale_id, amount, reason, method, refunded_by,
          register_session_id, line_ids, tax_amount, exchange_sale_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        a.quote.saleId,
        r.amount,
        reason,
        r.method,
        a.cashier.employee_id,
        sessionId,
        i === 0 ? a.quote.lineIds : null, // returned items live on one row
        taxShare(r.amount),
        a.newSale.id,
      ],
    );
    firstRefundId ??= ins.rows[0].id;
    if (r.method === "store_credit" && a.customerId) {
      await moveStoreCredit(client, {
        customerId: a.customerId,
        delta: r.amount,
        kind: "exchange",
        reason: `Exchange difference — ${a.quote.saleNumber} → ${a.newSale.number}`,
        saleId: a.newSale.id,
        refundId: ins.rows[0].id,
        employeeId: a.cashier.employee_id,
      });
    }
  }

  if (a.quote.fullyRefunded) {
    await client.query(`UPDATE pos_sales SET status = 'refunded' WHERE id = $1`, [a.quote.saleId]);
  }
  await restockReturnedLines(client, {
    saleId: a.quote.saleId,
    lineIds: a.quote.lineIds,
    fullyRefunded: a.quote.fullyRefunded,
    tenantId: a.cashier.tid,
    userId: a.cashier.user_id,
    reason: "pos_exchange",
  });

  // Same points reversal a refund queues; the new sale earns separately.
  if (a.quote.customerId != null && firstRefundId != null) {
    const pct = a.quote.saleTotal > 0 ? Math.min(1, a.quote.credit / a.quote.saleTotal) : 1;
    await queueLoyaltyCall(client, "/api/v1/refund", {
      idempotency_key: `${String(firstRefundId).padStart(8, "0")}-pos-refund`,
      sale_id: a.quote.saleId,
      refund_amount: a.quote.credit,
      refund_pct: pct,
    });
  }
}
