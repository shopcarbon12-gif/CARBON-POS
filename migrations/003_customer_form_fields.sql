-- Carbon POS — extended customer fields for the redesigned customer form.
--
-- The new customer form (per /sales/{code} screenshot) replaces the single
-- `phone` + `email` fields with a structured set: three phone slots, a
-- mailing address, two emails, an optional company / website / tags, and
-- contact-channel consent flags. We also surface "Created by + when" on
-- the edit page, which needs a created_by_user_id link.
--
-- All ADD COLUMNs are IF NOT EXISTS so this migration is idempotent.

BEGIN;

ALTER TABLE pos_customers
  ADD COLUMN IF NOT EXISTS company        TEXT,
  ADD COLUMN IF NOT EXISTS home_phone     TEXT,
  ADD COLUMN IF NOT EXISTS work_phone     TEXT,
  ADD COLUMN IF NOT EXISTS mobile_phone   TEXT,
  ADD COLUMN IF NOT EXISTS address_line1  TEXT,
  ADD COLUMN IF NOT EXISTS address_line2  TEXT,
  ADD COLUMN IF NOT EXISTS city           TEXT,
  ADD COLUMN IF NOT EXISTS state          TEXT,
  ADD COLUMN IF NOT EXISTS zip            TEXT,
  ADD COLUMN IF NOT EXISTS country        TEXT,
  ADD COLUMN IF NOT EXISTS email_2        TEXT,
  ADD COLUMN IF NOT EXISTS tags           TEXT[],
  ADD COLUMN IF NOT EXISTS contact_consent  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_email_ok BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_mail_ok  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS contact_call_ok  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill the new mobile_phone from the legacy `phone` column so existing
-- customers don't appear blank in the redesigned form. Leaves `phone` in
-- place for backward compatibility (sale receipts read from it).
UPDATE pos_customers
   SET mobile_phone = phone
 WHERE mobile_phone IS NULL AND phone IS NOT NULL AND phone <> '';

COMMIT;
