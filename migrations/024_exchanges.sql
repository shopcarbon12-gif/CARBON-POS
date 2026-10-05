-- 024_exchanges.sql
--
-- Exchanges (2026-10-05). An exchange is recorded as:
--   * a pos_refunds row on the ORIGINAL sale with method 'exchange' for
--     the credit applied to the new sale (+ line_ids of the returned
--     items, exchange_sale_id → the new sale), and — when the returned
--     items are worth more than the new ones — a second refund row
--     (cash / store_credit) for the difference given back;
--   * the NEW sale paying that credit with a pos_payments row of method
--     'exchange_credit', plus normal tenders for any difference due.
-- Reports then show the new sale as a sale and the return as a refund,
-- so net revenue is correct.
--
-- Idempotent: constraints dropped/re-added, ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE pos_payments DROP CONSTRAINT IF EXISTS pos_payments_method_check;
ALTER TABLE pos_payments
  ADD CONSTRAINT pos_payments_method_check
  CHECK (method IN ('card','cash','check','store_credit','account','gift_card','exchange_credit'));

ALTER TABLE pos_refunds DROP CONSTRAINT IF EXISTS pos_refunds_method_check;
ALTER TABLE pos_refunds
  ADD CONSTRAINT pos_refunds_method_check
  CHECK (method IN ('original_card','cash','store_credit','exchange'));

ALTER TABLE pos_refunds
  ADD COLUMN IF NOT EXISTS exchange_sale_id INT REFERENCES pos_sales(id);

COMMIT;
