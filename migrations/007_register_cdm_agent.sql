-- 007_register_cdm_agent.sql
--
-- Links a pos_register to the CDM agent that drives its RFID reader. The
-- POS reader-control endpoints look this up to send per-agent live-scan
-- start/stop calls to WMS, so each cashier's reader can be powered
-- independently. NULL = register has no RFID reader paired (cash/barcode
-- only) — the sell-screen badge shows "no reader" and the auto-start
-- effect is skipped.
--
-- The actual agent rows live in cdm_agents in the shared WMS database;
-- we don't FK across the WMS schema boundary so this column is just a
-- soft reference. POS validates the UUID exists by hitting WMS when the
-- value is set via the admin UI.

ALTER TABLE pos_registers
  ADD COLUMN IF NOT EXISTS cdm_agent_id UUID NULL;

CREATE INDEX IF NOT EXISTS pos_registers_cdm_agent_idx
  ON pos_registers (cdm_agent_id)
  WHERE cdm_agent_id IS NOT NULL;
