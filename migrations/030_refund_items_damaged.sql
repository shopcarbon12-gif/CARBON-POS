-- 030_refund_items_damaged.sql
--
-- Returned pieces can be flagged damaged at the register (refund or
-- exchange). Damaged RFID pieces go back to the store as status 'damaged'
-- instead of 'in-stock', so they're accounted for but not sellable.
ALTER TABLE pos_refund_items
  ADD COLUMN IF NOT EXISTS damaged BOOLEAN NOT NULL DEFAULT FALSE;
