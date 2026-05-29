-- 012_customer_phone_consolidation.sql
-- Consolidate the customer contact model down to two phones + two emails and
-- drop the fields the back-office form no longer collects.
--
-- Removes:  customer_type, company, home_phone, work_phone, mobile_phone
-- Keeps:    phone (now surfaced as "Phone 1"), email (Email 1), email_2 (Email 2)
-- Adds:     phone_2 (Phone 2)
--
-- `customer_type` was never enforced anywhere in pricing (the discount engine
-- exposes an applies_to='customer_type' option but no code reads the column),
-- so dropping it only removes the unused selector. The register / RFID-reader
-- loyalty phone lookup is rewired in app code to match phone + phone_2.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + DROP COLUMN IF EXISTS, all in one txn.

BEGIN;

-- 1. New secondary phone column.
ALTER TABLE pos_customers
  ADD COLUMN IF NOT EXISTS phone_2 TEXT;

-- 2. Preserve numbers before we drop the old phone columns.
--    `phone` (Phone 1) keeps whatever it has, falling back to the old mobile.
UPDATE pos_customers
   SET phone = mobile_phone
 WHERE (phone IS NULL OR phone = '')
   AND mobile_phone IS NOT NULL AND mobile_phone <> '';

--    Carry a second number (home, else work) into phone_2 so we don't lose it.
UPDATE pos_customers
   SET phone_2 = COALESCE(NULLIF(home_phone, ''), NULLIF(work_phone, ''))
 WHERE (phone_2 IS NULL OR phone_2 = '')
   AND (COALESCE(home_phone, '') <> '' OR COALESCE(work_phone, '') <> '');

-- 3. Drop the retired columns. DROP COLUMN also removes the inline CHECK
--    constraint on customer_type.
ALTER TABLE pos_customers
  DROP COLUMN IF EXISTS customer_type,
  DROP COLUMN IF EXISTS company,
  DROP COLUMN IF EXISTS home_phone,
  DROP COLUMN IF EXISTS work_phone,
  DROP COLUMN IF EXISTS mobile_phone;

COMMIT;
