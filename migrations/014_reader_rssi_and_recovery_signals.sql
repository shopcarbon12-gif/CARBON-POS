-- 014_reader_rssi_and_recovery_signals.sql
--
-- POS reader redesign (2026-05-30). The register reader now runs at a CONSTANT
-- RF power (33 dBm, set by the CDM agent) and is NEVER reconfigured by the
-- cashier — changing RF power is what wedged the chip. Proximity is now done in
-- software via per-tag RSSI: the reader reads everything, the POS shows only
-- tags at/above an RSSI threshold (the slider). And the agent only runs its
-- aggressive recovery while the cashier is actually present (armed) or actively
-- scanning, so it never resets an idle reader.
--
-- Columns added to pos_register_sessions (one open session per register):
--   live_power_dbm        — legacy RF-power override (kept for back-compat;
--                           no longer drives the radio). Defined here because
--                           it was used in code but never migrated.
--   rssi_threshold_dbm    — UI proximity filter. Tags with rssi < this value
--                           are hidden from the cart/scan UI. NULL = show all.
--                           RSSI is negative dBm (closer = higher, e.g. -45).
--   monitor_armed_at      — refreshed (heartbeat) while a cashier is parked on
--                           a scan surface (cart page / Update Item Status).
--                           Arms the agent's watch-hard recovery.
--   scanning_active_at    — refreshed while the Scan RFID / Update Item Status
--                           modal is actively open. Arms the tighter
--                           "no reads for 30s → recover" rule.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, safe to re-run on every deploy.

BEGIN;

ALTER TABLE pos_register_sessions
  ADD COLUMN IF NOT EXISTS live_power_dbm INT,
  ADD COLUMN IF NOT EXISTS rssi_threshold_dbm INT,
  ADD COLUMN IF NOT EXISTS monitor_armed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scanning_active_at TIMESTAMPTZ;

-- Range guard for live_power_dbm (1..33) — only added once, ignore if present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_register_sessions_live_power_dbm_range'
  ) THEN
    ALTER TABLE pos_register_sessions
      ADD CONSTRAINT pos_register_sessions_live_power_dbm_range
      CHECK (live_power_dbm IS NULL OR (live_power_dbm >= 1 AND live_power_dbm <= 33));
  END IF;
END $$;

-- Range guard for rssi_threshold_dbm (-90..-20, negative dBm).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pos_register_sessions_rssi_threshold_range'
  ) THEN
    ALTER TABLE pos_register_sessions
      ADD CONSTRAINT pos_register_sessions_rssi_threshold_range
      CHECK (rssi_threshold_dbm IS NULL OR (rssi_threshold_dbm >= -90 AND rssi_threshold_dbm <= -20));
  END IF;
END $$;

COMMIT;
