-- 015_sale_line_loyalty_redemption.sql
--
-- Allow pos_sale_lines.line_type = 'loyalty_redemption'. The capture route
-- has accepted and inserted redemption lines (points applied as a discount)
-- since the loyalty integration shipped, but the original CHECK from 001
-- only allowed product / misc / gift_card — so every sale with a points
-- redemption failed the INSERT and rolled back (card refunded). The
-- Carbon-Rewards customer_purchases view already expects this value and
-- excludes it from item counts.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD, safe to re-run.

BEGIN;

ALTER TABLE pos_sale_lines
  DROP CONSTRAINT IF EXISTS pos_sale_lines_line_type_check;

ALTER TABLE pos_sale_lines
  ADD CONSTRAINT pos_sale_lines_line_type_check
  CHECK (line_type IN ('product','misc','gift_card','loyalty_redemption'));

COMMIT;
