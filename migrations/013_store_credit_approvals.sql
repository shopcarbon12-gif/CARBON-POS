-- 013_store_credit_approvals.sql
-- Email-token approval gate for store-credit adjustments.
--
-- Anyone who is NOT the store-credit approver (elior@carbonjeanscompany.com)
-- must request approval: the server generates a 6-digit code, emails it to the
-- approver along with the exact amount + customer + requester, and the change
-- only applies once that code is entered. The code is bound to (customer, delta)
-- so an approval authorizes that ONE amount and nothing else.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_store_credit_approvals (
  id                       BIGSERIAL PRIMARY KEY,
  customer_id              INTEGER NOT NULL REFERENCES pos_customers(id) ON DELETE CASCADE,
  delta                    NUMERIC(10,2) NOT NULL,
  reason                   TEXT,
  -- sha256(code | customer_id | delta) — never store the raw code.
  code_hash                TEXT NOT NULL,
  requested_by_employee_id INTEGER,
  requested_by_email       TEXT,
  sent_to                  TEXT NOT NULL,
  attempts                 INTEGER NOT NULL DEFAULT 0,
  expires_at               TIMESTAMPTZ NOT NULL,
  consumed_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_store_credit_approvals_customer_idx
  ON pos_store_credit_approvals (customer_id, created_at DESC);

COMMIT;
