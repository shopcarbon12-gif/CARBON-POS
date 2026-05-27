-- ---------------------------------------------------------------------------
-- 011_employee_attribution.sql
--
-- Adds per-sale and per-line "credited employee" so a cashier can ring a
-- sale on behalf of another sales associate. attributed_employee_id is
-- the source of truth for commission/credit reports; cashier_id remains
-- the person who physically operated the register.
--
-- Historical rows are backfilled with cashier_id so existing reports stay
-- continuous and the columns can stay NOT NULL going forward.
-- ---------------------------------------------------------------------------

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS attributed_employee_id INTEGER
    REFERENCES pos_employees(id);

UPDATE pos_sales
   SET attributed_employee_id = cashier_id
 WHERE attributed_employee_id IS NULL;

ALTER TABLE pos_sales
  ALTER COLUMN attributed_employee_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS pos_sales_attributed_employee_idx
  ON pos_sales (attributed_employee_id, completed_at DESC);

ALTER TABLE pos_sale_lines
  ADD COLUMN IF NOT EXISTS attributed_employee_id INTEGER
    REFERENCES pos_employees(id);

UPDATE pos_sale_lines sl
   SET attributed_employee_id = s.cashier_id
  FROM pos_sales s
 WHERE s.id = sl.sale_id
   AND sl.attributed_employee_id IS NULL;

ALTER TABLE pos_sale_lines
  ALTER COLUMN attributed_employee_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS pos_sale_lines_attributed_employee_idx
  ON pos_sale_lines (attributed_employee_id);
