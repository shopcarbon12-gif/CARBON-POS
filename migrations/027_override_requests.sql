-- 027_override_requests.sql
--
-- Approved overrides (2026-10-06). Some actions need an admin's OK:
--   rfid_sale        sell an RFID item without scanning its tag
--   rfid_return      take back an RFID item without scanning its tag
--   exchange_payout  pay an exchange difference back to the original
--                    payment instead of store credit
-- Approval is an admin PIN on the register, or a one-time 6-digit code
-- emailed to the approver (Elior) that he hands to the employee. Codes
-- are stored hashed and bound to (kind, ref); 15-minute expiry, 5 tries,
-- single use.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

CREATE TABLE IF NOT EXISTS pos_override_requests (
  id                   BIGSERIAL PRIMARY KEY,
  pos_location_id      INT REFERENCES pos_locations(id),
  kind                 TEXT NOT NULL CHECK (kind IN ('rfid_sale','rfid_return','exchange_payout')),
  ref                  TEXT NOT NULL,
  detail               TEXT,
  code_hash            TEXT NOT NULL,
  requested_by         INT REFERENCES pos_employees(id),
  requested_by_email   TEXT,
  sent_to              TEXT NOT NULL,
  attempts             INT NOT NULL DEFAULT 0,
  expires_at           TIMESTAMPTZ NOT NULL,
  approved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_override_requests_loc_idx
  ON pos_override_requests (pos_location_id, created_at DESC);

-- Who approved the override, on what it was used for.
ALTER TABLE pos_sale_lines   ADD COLUMN IF NOT EXISTS override_by TEXT;
ALTER TABLE pos_refund_items ADD COLUMN IF NOT EXISTS override_by TEXT;
ALTER TABLE pos_refunds      ADD COLUMN IF NOT EXISTS override_by TEXT;

COMMIT;
