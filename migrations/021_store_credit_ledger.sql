-- 021_store_credit_ledger.sql
--
-- Real store credit (2026-10-05). Refunds to store credit and store-credit
-- tenders at checkout only wrote a refund/payment row — the customer's
-- balance never moved. Every movement now updates
-- pos_customers.store_credit_balance in the same transaction and lands
-- here with the resulting balance, so the customer page can show a full
-- history (refund in, purchase out, manual adjustment).
--
-- Idempotent: IF NOT EXISTS everywhere.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_store_credit_ledger (
  id             BIGSERIAL PRIMARY KEY,
  customer_id    INT NOT NULL REFERENCES pos_customers(id) ON DELETE CASCADE,
  delta          NUMERIC(10,2) NOT NULL,
  balance_after  NUMERIC(10,2) NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('refund','purchase','adjustment','exchange')),
  reason         TEXT,
  sale_id        INT REFERENCES pos_sales(id),
  refund_id      INT REFERENCES pos_refunds(id),
  employee_id    INT REFERENCES pos_employees(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_store_credit_ledger_customer_idx
  ON pos_store_credit_ledger (customer_id, created_at DESC);

COMMIT;
