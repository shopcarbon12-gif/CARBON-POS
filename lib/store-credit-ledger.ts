import type { PoolClient } from "pg";

export class StoreCreditError extends Error {
  constructor(
    readonly code: "no_customer" | "insufficient" | "not_found",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Move a customer's store credit inside the caller's transaction: locks
 * the customer row, refuses to go below $0, updates the balance and
 * writes a pos_store_credit_ledger row. Returns the new balance.
 */
export async function moveStoreCredit(
  client: PoolClient,
  m: {
    customerId: number;
    delta: number;
    kind: "refund" | "purchase" | "adjustment" | "exchange";
    reason?: string | null;
    saleId?: number | null;
    refundId?: number | null;
    employeeId?: number | null;
  },
): Promise<number> {
  const cur = await client.query<{ store_credit_balance: string }>(
    `SELECT store_credit_balance FROM pos_customers WHERE id = $1 FOR UPDATE`,
    [m.customerId],
  );
  if (!cur.rows[0]) throw new StoreCreditError("not_found", "Customer not found.");
  const balance = Number(cur.rows[0].store_credit_balance);
  const next = Math.round((balance + m.delta) * 100) / 100;
  if (next < -0.005) {
    throw new StoreCreditError(
      "insufficient",
      `Not enough store credit: the customer has $${balance.toFixed(2)}, this needs $${Math.abs(m.delta).toFixed(2)}.`,
    );
  }
  await client.query(
    `UPDATE pos_customers SET store_credit_balance = $2 WHERE id = $1`,
    [m.customerId, next],
  );
  await client.query(
    `INSERT INTO pos_store_credit_ledger
       (customer_id, delta, balance_after, kind, reason, sale_id, refund_id, employee_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      m.customerId,
      m.delta,
      next,
      m.kind,
      m.reason ?? null,
      m.saleId ?? null,
      m.refundId ?? null,
      m.employeeId ?? null,
    ],
  );
  return next;
}
