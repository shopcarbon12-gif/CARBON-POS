-- 019_refund_lines.sql
--
-- Refund receipts (2026-10-05). The refund screen lets the cashier tick
-- which items come back, but only the dollar total was saved, so a
-- refund receipt couldn't list the returned items. Store the ticked
-- pos_sale_lines ids on the refund row. NULL for older refunds.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE pos_refunds
  ADD COLUMN IF NOT EXISTS line_ids INT[];

COMMIT;
