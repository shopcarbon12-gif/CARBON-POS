-- 028_refund_approval.sql
--
-- Refunds need super admin approval (2026-10-11). Money going back to a
-- customer (refund to card / cash / store credit) is approved by the
-- super admin — an admin PIN on the register, or the one-time code
-- emailed to the approver — unless the admin is doing it. Adds the
-- 'refund' override kind; pos_refunds.override_by (027) records who
-- approved.
--
-- Idempotent: constraint dropped / re-added.

BEGIN;

ALTER TABLE pos_override_requests DROP CONSTRAINT IF EXISTS pos_override_requests_kind_check;
ALTER TABLE pos_override_requests
  ADD CONSTRAINT pos_override_requests_kind_check
  CHECK (kind IN ('rfid_sale','rfid_return','exchange_payout','refund'));

COMMIT;
