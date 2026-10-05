-- 023_held_sales.sql
--
-- Hold / park a sale (2026-10-05). The cashier parks the current cart
-- (items, customer, discounts) to serve someone else and resumes it later
-- from any register at the store. Stored server-side so a held cart
-- survives a browser refresh or a different terminal. Resuming deletes
-- the row.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_held_sales (
  id              SERIAL PRIMARY KEY,
  pos_location_id INT NOT NULL REFERENCES pos_locations(id),
  held_by         INT REFERENCES pos_employees(id),
  customer_id     INT REFERENCES pos_customers(id) ON DELETE SET NULL,
  customer_name   TEXT,
  label           TEXT,
  cart            JSONB NOT NULL,
  item_count      INT NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_held_sales_location_idx
  ON pos_held_sales (pos_location_id, created_at DESC);

COMMIT;
