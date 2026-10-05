-- 018_refund_tax_amount.sql
--
-- Record the sales tax given back on each refund (2026-10-05). Refunds
-- are whole-amount (not per line), so the refund route stores the
-- refunded share of the original sale's tax:
--     tax_amount = round(refund amount × sale tax ÷ sale total, 2)
-- The Sales Tax report reads this recorded figure instead of working it
-- out after the fact. Existing refunds are backfilled with the same
-- formula.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; backfill only touches NULLs.

BEGIN;

ALTER TABLE pos_refunds
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(10,2);

UPDATE pos_refunds rf
   SET tax_amount = CASE WHEN s.total_amount > 0
                         THEN ROUND(rf.amount * s.tax_amount / s.total_amount, 2)
                         ELSE 0 END
  FROM pos_sales s
 WHERE s.id = rf.original_sale_id
   AND rf.tax_amount IS NULL;

COMMIT;
