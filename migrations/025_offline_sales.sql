-- 025_offline_sales.sql
--
-- Offline cash sales (2026-10-05). When the register loses the internet,
-- cash sales are kept on the device and sent to /api/pos/payment/capture
-- once it's back. Each carries a client-generated UUID so a retried send
-- can never create the sale twice, and the time it was actually rung up
-- (the sale is stamped with that time so it lands on the right day and
-- register shift).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS.

BEGIN;

ALTER TABLE pos_sales
  ADD COLUMN IF NOT EXISTS client_uuid UUID,
  ADD COLUMN IF NOT EXISTS recorded_offline BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS pos_sales_client_uuid_key
  ON pos_sales (client_uuid) WHERE client_uuid IS NOT NULL;

COMMIT;
