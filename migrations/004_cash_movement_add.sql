-- 004_cash_movement_add.sql
--
-- Allow 'add' as a cash movement type. An 'add' is the inverse of a 'drop':
-- cash being put INTO the drawer (e.g. starting a shift with extra change,
-- breaking bills from the safe). Surfaces as the "Add Amount" action on the
-- Sales tab, and is added (not subtracted) when computing expected cash at
-- close.

ALTER TABLE pos_cash_movements
  DROP CONSTRAINT IF EXISTS pos_cash_movements_type_check;

ALTER TABLE pos_cash_movements
  ADD CONSTRAINT pos_cash_movements_type_check
  CHECK (type IN ('drop', 'payout', 'add'));
