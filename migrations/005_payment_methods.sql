-- 005_payment_methods.sql
--
-- Extend pos_payments.method to allow 'account' (charge to a customer's
-- credit account on file) and 'gift_card' (pay against a gift card
-- balance) — both shown alongside Store Credit on the "Other" payment
-- screen. Keep 'check' as a legal value so legacy rows still satisfy the
-- constraint; the UI no longer exposes Check as a new-payment option.

ALTER TABLE pos_payments
  DROP CONSTRAINT IF EXISTS pos_payments_method_check;

ALTER TABLE pos_payments
  ADD CONSTRAINT pos_payments_method_check
  CHECK (method IN ('card','cash','check','store_credit','account','gift_card'));

-- Generic reference column reused across the new methods:
--   - account:    optional PO number / customer note
--   - gift_card:  card number / serial
-- Existing rows stay NULL; the column is nullable.
ALTER TABLE pos_payments
  ADD COLUMN IF NOT EXISTS reference TEXT;
