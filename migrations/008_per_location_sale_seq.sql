-- Carbon POS — per-location sale-number counter.
--
-- The sale_number used to be POS-00001 globally. Going forward the cashier
-- and the EAN-13 barcode below the receipt need a 12-digit numeric format:
--
--     [1100000] [LL]  [SSS]
--      prefix    loc   per-location sequence (no reset)
--
-- e.g. location id=1, third sale at that store -> 110000001003.
-- The 13th printed digit on the barcode is the EAN-13 check digit, computed
-- by the barcode renderer (not stored).
--
-- The old global pos_sale_number_seq stays around so existing POS-xxxxx
-- numbers remain valid; new sales just stop calling it. Old and new rows
-- coexist under the UNIQUE(sale_number) constraint since the formats can't
-- collide (one starts with "POS-", the other with "11").

BEGIN;

ALTER TABLE pos_locations
  ADD COLUMN IF NOT EXISTS next_sale_seq INTEGER NOT NULL DEFAULT 1;

COMMIT;
