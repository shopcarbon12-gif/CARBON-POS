-- Carbon POS — initial schema
-- All POS-owned tables are prefixed pos_*. They live in the same Postgres
-- database as CarbonWMS and reference WMS tables (locations, custom_skus,
-- epcs, users) via foreign keys. POS only writes to pos_* tables; WMS
-- tables are read-only from POS except for one controlled UPDATE on
-- epcs.status when a sale is finalized.
--
-- Apply with:  psql "$DATABASE_URL" -f migrations/001_create_pos_tables.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- pos_locations — every POS storefront maps to exactly one WMS location.
-- Holds POS-specific store config (tax rate, receipt copy, timezone).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_locations (
  id              SERIAL PRIMARY KEY,
  wms_location_id UUID NOT NULL REFERENCES locations(id),
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  phone           TEXT,
  tax_rate        NUMERIC(5,4) NOT NULL DEFAULT 0.07,
  receipt_header  TEXT,
  receipt_footer  TEXT,
  return_policy   TEXT,
  timezone        TEXT NOT NULL DEFAULT 'America/New_York',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pos_locations_wms_location_unique UNIQUE (wms_location_id)
);

-- ---------------------------------------------------------------------------
-- pos_registers — physical till. Pairs to a Stripe Terminal reader by id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_registers (
  id                  SERIAL PRIMARY KEY,
  pos_location_id     INTEGER NOT NULL REFERENCES pos_locations(id),
  name                TEXT NOT NULL,
  stripe_reader_id    TEXT,
  stripe_reader_label TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_registers_location_idx
  ON pos_registers (pos_location_id);

-- ---------------------------------------------------------------------------
-- pos_register_sessions — one row per cash-drawer open/close cycle.
-- The cashier opens a session at start of shift, closes it at end of shift.
-- expected_cash and cash_over_short are computed at close time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_register_sessions (
  id                   SERIAL PRIMARY KEY,
  register_id          INTEGER NOT NULL REFERENCES pos_registers(id),
  opened_by            UUID NOT NULL REFERENCES users(id),
  opened_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash         NUMERIC(10,2) NOT NULL,
  closed_by            UUID REFERENCES users(id),
  closed_at            TIMESTAMPTZ,
  closing_cash_counted NUMERIC(10,2),
  expected_cash        NUMERIC(10,2),
  cash_over_short      NUMERIC(10,2),
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','closed'))
);

CREATE INDEX IF NOT EXISTS pos_register_sessions_register_idx
  ON pos_register_sessions (register_id, status);

-- Only one open session per register at a time. Prevents two cashiers
-- accidentally sharing a drawer without one of them closing first.
CREATE UNIQUE INDEX IF NOT EXISTS pos_register_sessions_one_open
  ON pos_register_sessions (register_id)
  WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- pos_cash_movements — drops (cash to safe/bank) and payouts (petty cash out).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id                  SERIAL PRIMARY KEY,
  register_session_id INTEGER NOT NULL REFERENCES pos_register_sessions(id),
  type                TEXT NOT NULL CHECK (type IN ('drop','payout')),
  amount              NUMERIC(10,2) NOT NULL,
  reason              TEXT,
  done_by             UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_cash_movements_session_idx
  ON pos_cash_movements (register_session_id);

-- ---------------------------------------------------------------------------
-- pos_customers — POS-specific customer profile. Optional on a sale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_customers (
  id                   SERIAL PRIMARY KEY,
  pos_location_id      INTEGER REFERENCES pos_locations(id),
  first_name           TEXT NOT NULL,
  last_name            TEXT,
  email                TEXT,
  phone                TEXT,
  birthday             DATE,
  customer_type        TEXT NOT NULL DEFAULT 'regular'
                         CHECK (customer_type IN ('regular','vip','staff','wholesale')),
  store_credit_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_customers_email_idx ON pos_customers (lower(email));
CREATE INDEX IF NOT EXISTS pos_customers_phone_idx ON pos_customers (phone);
CREATE INDEX IF NOT EXISTS pos_customers_name_idx
  ON pos_customers (lower(last_name), lower(first_name));

-- ---------------------------------------------------------------------------
-- pos_employees — POS-only fields layered on top of WMS users.
-- pin_hash is a bcrypt hash of the cashier's 4-digit register PIN.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_employees (
  id          SERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) UNIQUE,
  pin_hash    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'cashier'
                CHECK (role IN ('cashier','supervisor','manager','admin')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- pos_employee_clock — clock-in/clock-out events for hours reporting.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_employee_clock (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES pos_employees(id),
  clock_in    TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out   TIMESTAMPTZ,
  register_id INTEGER REFERENCES pos_registers(id)
);

CREATE INDEX IF NOT EXISTS pos_employee_clock_employee_idx
  ON pos_employee_clock (employee_id, clock_in DESC);

-- ---------------------------------------------------------------------------
-- pos_sales — header row. sale_number is a human-friendly identifier.
-- A sale starts with status='open' and flips to 'completed' inside the
-- single transaction that also writes lines, payments, and updates EPCs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sales (
  id              SERIAL PRIMARY KEY,
  sale_number     TEXT NOT NULL UNIQUE,
  register_id     INTEGER NOT NULL REFERENCES pos_registers(id),
  pos_location_id INTEGER NOT NULL REFERENCES pos_locations(id),
  cashier_id      INTEGER NOT NULL REFERENCES pos_employees(id),
  customer_id     INTEGER REFERENCES pos_customers(id),
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','completed','voided','refunded')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  voided_at       TIMESTAMPTZ,
  voided_by       INTEGER REFERENCES pos_employees(id),
  void_reason     TEXT
);

CREATE INDEX IF NOT EXISTS pos_sales_register_idx
  ON pos_sales (register_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_sales_location_idx
  ON pos_sales (pos_location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_sales_cashier_idx
  ON pos_sales (cashier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_sales_customer_idx
  ON pos_sales (customer_id);
CREATE INDEX IF NOT EXISTS pos_sales_status_idx ON pos_sales (status);

-- Sequence used to format sale_number as POS-00001, POS-00002, ...
CREATE SEQUENCE IF NOT EXISTS pos_sale_number_seq START 1;

-- ---------------------------------------------------------------------------
-- pos_sale_lines — line items on a sale. description is a snapshot of the
-- item name at the time of sale so an admin renaming a SKU later doesn't
-- rewrite history. epc captures the specific RFID tag scanned, when known.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sale_lines (
  id              SERIAL PRIMARY KEY,
  sale_id         INTEGER NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  sku_id          UUID REFERENCES custom_skus(id),
  epc             TEXT,
  description     TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_rate        NUMERIC(5,4) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  line_total      NUMERIC(10,2) NOT NULL,
  line_type       TEXT NOT NULL DEFAULT 'product'
                    CHECK (line_type IN ('product','misc','gift_card'))
);

CREATE INDEX IF NOT EXISTS pos_sale_lines_sale_idx ON pos_sale_lines (sale_id);
CREATE INDEX IF NOT EXISTS pos_sale_lines_sku_idx ON pos_sale_lines (sku_id);
CREATE INDEX IF NOT EXISTS pos_sale_lines_epc_idx ON pos_sale_lines (epc);

-- ---------------------------------------------------------------------------
-- pos_payments — one or more payments per sale. Split payments produce
-- multiple rows with the same sale_id (one per method).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_payments (
  id                       SERIAL PRIMARY KEY,
  sale_id                  INTEGER NOT NULL REFERENCES pos_sales(id),
  method                   TEXT NOT NULL
                             CHECK (method IN ('card','cash','check','store_credit')),
  amount                   NUMERIC(10,2) NOT NULL,
  stripe_payment_intent_id TEXT,
  stripe_reader_id         TEXT,
  cash_given               NUMERIC(10,2),
  change_given             NUMERIC(10,2),
  check_number             TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','completed','failed','refunded')),
  processed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pos_payments_sale_idx ON pos_payments (sale_id);
CREATE INDEX IF NOT EXISTS pos_payments_intent_idx
  ON pos_payments (stripe_payment_intent_id);

-- ---------------------------------------------------------------------------
-- pos_refunds — one row per refund event against an existing sale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_refunds (
  id               SERIAL PRIMARY KEY,
  original_sale_id INTEGER NOT NULL REFERENCES pos_sales(id),
  amount           NUMERIC(10,2) NOT NULL,
  reason           TEXT,
  method           TEXT NOT NULL
                     CHECK (method IN ('original_card','cash','store_credit')),
  stripe_refund_id TEXT,
  refunded_by      INTEGER NOT NULL REFERENCES pos_employees(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_refunds_sale_idx ON pos_refunds (original_sale_id);

-- ---------------------------------------------------------------------------
-- pos_discount_rules — admin-configured promos. Optional on a sale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_discount_rules (
  id                   SERIAL PRIMARY KEY,
  pos_location_id      INTEGER REFERENCES pos_locations(id),
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value                NUMERIC(10,2) NOT NULL,
  applies_to           TEXT NOT NULL
                         CHECK (applies_to IN ('all','customer_type','sku_id')),
  -- For applies_to='sku_id' this holds the UUID as text. For 'customer_type'
  -- this holds 'regular'|'vip'|'staff'|'wholesale'. Plain TEXT either way.
  applies_to_value     TEXT,
  start_date           DATE,
  end_date             DATE,
  requires_manager_pin BOOLEAN NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_discount_rules_active_idx
  ON pos_discount_rules (is_active, start_date, end_date);

COMMIT;
