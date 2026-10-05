-- 020_sale_line_epcs.sql
--
-- Per-item refunds (2026-10-05). An RFID cart row can carry several tags
-- (qty > 1), but pos_sale_lines only stored the first one in `epc`, so a
-- refund could only ever put one of them back in stock. Store them all.
-- Existing rows are backfilled from `epc`.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; backfill only touches NULLs.

BEGIN;

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS epcs TEXT[];

UPDATE pos_sale_lines
   SET epcs = ARRAY[epc]
 WHERE epcs IS NULL AND epc IS NOT NULL;

COMMIT;
