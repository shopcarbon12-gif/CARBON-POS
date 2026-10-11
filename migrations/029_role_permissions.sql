-- 029_role_permissions.sql
--
-- POS honours the WMS POS-role permissions (2026-10-11). Each action is
-- 'view' (allowed), 'hide' (not allowed) or 'approval' (allowed after the
-- super admin approves on the register — admin PIN or emailed code).
--   * override kind 'permission' — approval for a role-gated action, ref
--     "<page>.<section>:<nonce>".
--   * pos_approval_uses — each approval token can be used once.
--
-- Idempotent.

BEGIN;

ALTER TABLE pos_override_requests DROP CONSTRAINT IF EXISTS pos_override_requests_kind_check;
ALTER TABLE pos_override_requests
  ADD CONSTRAINT pos_override_requests_kind_check
  CHECK (kind IN ('rfid_sale','rfid_return','exchange_payout','refund','permission'));

CREATE TABLE IF NOT EXISTS pos_approval_uses (
  token_hash  TEXT PRIMARY KEY,
  used_for    TEXT,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
