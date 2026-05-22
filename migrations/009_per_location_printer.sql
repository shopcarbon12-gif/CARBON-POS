-- Carbon POS — per-location thermal printer config.
--
-- Until now the printer was global: THERMAL_PRINTER_HOST / _PORT env vars
-- read on every sale. That doesn't scale to a multi-store deploy, and
-- requires a redeploy to change. Move the host/port into pos_locations
-- so each store has its own printer and managers can edit it from the
-- /settings/[code]/locations admin page.
--
-- The Orlando warehouse POS location is seeded with the known reader
-- address (192.168.1.28:9100) inline so we don't need a separate UI
-- step on first deploy. Other locations get NULL until configured.

BEGIN;

ALTER TABLE pos_locations
  ADD COLUMN IF NOT EXISTS printer_host TEXT,
  ADD COLUMN IF NOT EXISTS printer_port INTEGER NOT NULL DEFAULT 9100;

-- Seed Orlando (the first pos_location, per the bootstrap in 002) with
-- the known printer address. Only writes if the column hasn't been set
-- already so a manager's override via the admin UI doesn't get clobbered
-- on re-apply.
UPDATE pos_locations
   SET printer_host = '192.168.1.28',
       printer_port = 9100
 WHERE id = (SELECT id FROM pos_locations ORDER BY id LIMIT 1)
   AND printer_host IS NULL;

COMMIT;
