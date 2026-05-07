-- 006_loyalty_outbox.sql
--
-- Outbox table on the Carbon-POS side. When a sale completes and we need
-- to fire a /api/v1/earn (or /redeem, /refund) call to the Carbon-Loyalty
-- service, we INSERT a row here as part of the same DB transaction.
--
-- A small worker drains this table out-of-band: tries the HTTP call, marks
-- the row as posted on success, retries with backoff on failure. POS
-- never blocks the cashier on a loyalty timeout — the row sits here
-- waiting to be drained.

CREATE TABLE IF NOT EXISTS pos_loyalty_outbox (
  id              BIGSERIAL PRIMARY KEY,
  endpoint        TEXT NOT NULL CHECK (endpoint IN
                    ('/api/v1/earn','/api/v1/redeem','/api/v1/refund',
                     '/api/v1/customers/link','/api/admin/adjust')),
  payload         JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  posted_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_loyalty_outbox_pending_idx
  ON pos_loyalty_outbox (created_at) WHERE posted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_loyalty_outbox_idem_uq
  ON pos_loyalty_outbox (idempotency_key);
