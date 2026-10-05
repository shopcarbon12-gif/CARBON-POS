-- 017_print_agent.sql
--
-- Store print relay (2026-10-05). Browser → printer printing (ePOS-Print
-- over HTTPS) needs every device to trust the printer's self-signed
-- certificate (Chrome forgets the "proceed anyway" after a while) and to
-- answer Chrome's local-network prompt. Instead, the browser hands the
-- rendered ESC/POS bytes to the server, which queues them; a small
-- print agent on a PC in the store polls the queue over outbound HTTPS
-- and writes the bytes to the printer on its raw TCP port (9100).
--
--   pos_locations.print_agent_token_hash  — sha256 of the agent's key
--                                           (one agent per store)
--   pos_locations.print_agent_last_seen_at — last poll; agent counts as
--                                           online if seen < 45 s ago
--   pos_locations.print_agent_info        — hostname/version it reports
--   pos_print_jobs                        — the queue
--
-- Idempotent: IF NOT EXISTS everywhere, safe to re-run.

BEGIN;

ALTER TABLE pos_locations
  ADD COLUMN IF NOT EXISTS print_agent_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS print_agent_last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS print_agent_info TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pos_locations_print_agent_token_idx
  ON pos_locations (print_agent_token_hash)
  WHERE print_agent_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_print_jobs (
  id              BIGSERIAL PRIMARY KEY,
  pos_location_id INT NOT NULL REFERENCES pos_locations(id),
  payload         BYTEA NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sending','printed','failed','expired')),
  attempts        INT NOT NULL DEFAULT 0,
  error           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pos_print_jobs_queue_idx
  ON pos_print_jobs (pos_location_id, status, id);

COMMIT;
