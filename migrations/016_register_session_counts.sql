-- 016_register_session_counts.sql
--
-- Register Open / End-of-Day reports (2026-10-05). Until now only the
-- opening and closing cash *totals* were stored; the per-bill counts,
-- the per-tender counted amounts and the close note only ever reached
-- the paper slip. The Reports tab needs to rebuild both reports for any
-- past session, so persist them on the session row:
--
--   opening_denoms  — {"100":0,"50":1,"20":5,...}  bills counted at open
--   closing_denoms  — same shape, bills counted at close
--   closing_counts  — [{key,label,calculated,counted,over_short}, ...]
--                     the Calculated / Counted / +/- rows the cashier saw
--   close_note      — free-text note entered on close
--
-- All nullable — sessions opened before this migration simply show no
-- breakdown. Idempotent: ADD COLUMN IF NOT EXISTS, safe to re-run.

BEGIN;

ALTER TABLE pos_register_sessions
  ADD COLUMN IF NOT EXISTS opening_denoms JSONB,
  ADD COLUMN IF NOT EXISTS closing_denoms JSONB,
  ADD COLUMN IF NOT EXISTS closing_counts JSONB,
  ADD COLUMN IF NOT EXISTS close_note TEXT;

COMMIT;
