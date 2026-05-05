-- Carbon POS — bootstrap seed
--
-- Idempotent. On first run after the schema is created, this inserts:
--   1. a pos_locations row mapping to the FIRST WMS locations row, IF the
--      pos_locations table is empty.
--   2. a pos_registers row ("Register 1") for that pos_location, IF the
--      pos_registers table is empty.
--
-- This is the minimum needed for a cashier to actually open a register. The
-- first admin is auto-provisioned by auth.ts on the first password sign-in
-- (see the bootstrap path in authorize()).
--
-- Re-running this migration is safe — every INSERT is gated on a NOT EXISTS.
-- Schema-level columns and tax rate defaults can be edited from
-- /admin/settings/locations after the first sign-in.

BEGIN;

-- Map the first WMS location into POS. We only do this when no POS location
-- exists at all so we never silently bind to the wrong WMS site on later
-- redeploys. Managers can add more locations from the back office.
INSERT INTO pos_locations (
  wms_location_id,
  tax_rate,
  receipt_header,
  receipt_footer,
  return_policy,
  timezone,
  is_active
)
SELECT l.id,
       0.07,
       'Carbon Jeans Company',
       'Thank you!',
       'Returns within 30 days with receipt.',
       'America/New_York',
       TRUE
  FROM locations l
 WHERE NOT EXISTS (SELECT 1 FROM pos_locations)
 ORDER BY l.created_at NULLS LAST, l.name
 LIMIT 1;

-- Make sure every existing pos_location has at least one register so the
-- cashier picker has something to show on day one.
INSERT INTO pos_registers (pos_location_id, name, is_active)
SELECT pl.id, 'Register 1', TRUE
  FROM pos_locations pl
 WHERE NOT EXISTS (
   SELECT 1 FROM pos_registers r WHERE r.pos_location_id = pl.id
 );

COMMIT;
