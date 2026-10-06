-- 026_refund_items.sql
--
-- Per-item, tag-verified returns (2026-10-06). Returns (refunds and
-- exchanges) are now recorded per returned piece: an RFID item by the
-- EPC that was scanned coming back (it must be a tag sold on that sale
-- line), a non-RFID item by quantity. Credit = the line's per-unit share
-- of its total; only those exact tags go back in stock.
--
-- pos_refunds.line_ids stays (lines touched) for older code/reports; a
-- line with no pos_refund_items rows but listed in line_ids is a legacy
-- whole-line return.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_refund_items (
  id            BIGSERIAL PRIMARY KEY,
  refund_id     INT NOT NULL REFERENCES pos_refunds(id) ON DELETE CASCADE,
  sale_line_id  INT NOT NULL REFERENCES pos_sale_lines(id),
  epc           TEXT,
  quantity      INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount        NUMERIC(10,2) NOT NULL,
  tax_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_refund_items_line_idx ON pos_refund_items (sale_line_id);
-- A sold tag can only come back once per sale line.
CREATE UNIQUE INDEX IF NOT EXISTS pos_refund_items_line_epc_key
  ON pos_refund_items (sale_line_id, epc) WHERE epc IS NOT NULL;

COMMIT;
