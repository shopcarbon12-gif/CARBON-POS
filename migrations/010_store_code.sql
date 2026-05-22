-- Carbon POS — operator-facing store code, decoupled from DB id.
--
-- Migration 008 used pos_locations.id as the 2-digit location component
-- of the sale_number. That meant Orlando Warehouse (id=2) printed as
-- "...02xxx" — but the operator numbers the Orlando store as "01" and
-- Elementi Florida Mall as "02". This migration adds an explicit
-- store_code column so the cashier-facing sale_number matches the
-- operator's mental model, independent of the DB insert order.
--
-- After this migration the format stays 12 digits, just the 2-digit
-- location component comes from pos_locations.store_code instead of id:
--
--     [1100000] [SS]    [SSS]
--      prefix    store    per-location sequence
--                code
--
-- e.g. Orlando (store_code='01'), 3rd sale -> 110000001003.

BEGIN;

ALTER TABLE pos_locations
  ADD COLUMN IF NOT EXISTS store_code TEXT;

UPDATE pos_locations pl
   SET store_code = '01'
  FROM locations l
 WHERE pl.wms_location_id = l.id
   AND l.name = 'Orlando Warehouse'
   AND pl.store_code IS NULL;

UPDATE pos_locations pl
   SET store_code = '02'
  FROM locations l
 WHERE pl.wms_location_id = l.id
   AND l.name = 'Elementi Florida Mall'
   AND pl.store_code IS NULL;

ALTER TABLE pos_locations
  ALTER COLUMN store_code SET NOT NULL;

ALTER TABLE pos_locations
  ADD CONSTRAINT pos_locations_store_code_format
    CHECK (store_code ~ '^[0-9]{2}$');

ALTER TABLE pos_locations
  ADD CONSTRAINT pos_locations_store_code_unique UNIQUE (store_code);

-- Renumber the two Orlando sales that landed under the old scheme so
-- the receipt history stays consistent with the new format.
UPDATE pos_sales SET sale_number = '110000001001' WHERE sale_number = '110000002001';
UPDATE pos_sales SET sale_number = '110000001002' WHERE sale_number = '110000002002';

COMMIT;
