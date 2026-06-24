-- SyncStock schema — plain PostgreSQL, no Supabase
-- Run once: psql -U postgres -d syncstock -f 001_schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Product mappings (3-state) ──────────────────────────────────────────────

CREATE TYPE mapping_status AS ENUM ('pending', 'approved', 'quarantine');

CREATE TABLE product_mappings (
  id                BIGSERIAL      PRIMARY KEY,
  bling_sku         TEXT           NOT NULL UNIQUE,
  wms_codigo        TEXT,           -- Smartgo codigoProduto (external or internal)
  match_score       NUMERIC(5,2),   -- 0–100
  status            mapping_status  NOT NULL DEFAULT 'pending',
  quarantine_reason TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX ON product_mappings (status);

-- ─── Idempotency keys ────────────────────────────────────────────────────────
-- Formula: SHA256(origin | event_type | entity_id | version)
-- Timestamp is NOT part of the key — goes only in received_at on webhook_events.

CREATE TABLE idempotency_keys (
  key          TEXT        PRIMARY KEY,
  queue        TEXT        NOT NULL,   -- 'bling_in' | 'wms_in'
  entity_ref   TEXT,                   -- human-readable: "bling/PEDIDO_VENDA/12345"
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON idempotency_keys (processed_at);  -- for nightly cleanup

-- ─── Raw webhook events (immutable log) ──────────────────────────────────────

CREATE TABLE webhook_events (
  id              BIGSERIAL   PRIMARY KEY,
  origin          TEXT        NOT NULL CHECK (origin IN ('bling','wms')),
  idempotency_key TEXT        NOT NULL REFERENCES idempotency_keys(key),
  raw_payload     JSONB       NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  queue_job_id    TEXT
);
CREATE INDEX ON webhook_events (origin, received_at DESC);

-- ─── Stock movements (delta ledger) ──────────────────────────────────────────
-- Webhooks ONLY write here. Never touch stock_snapshots.

CREATE TYPE movement_type AS ENUM ('reservation','physical','cancellation','adjustment');

CREATE TABLE stock_movements (
  id                  BIGSERIAL      PRIMARY KEY,
  bling_order_id      TEXT           NOT NULL,
  bling_sku           TEXT           NOT NULL REFERENCES product_mappings(bling_sku),
  delta               INTEGER        NOT NULL,   -- negative = outbound
  movement_type       movement_type  NOT NULL,
  wms_ref             TEXT,                      -- Smartgo codigoInterno (set after wms_out)
  matched_to          BIGINT         REFERENCES stock_movements(id),  -- reservation → physical
  event_received_at   TIMESTAMPTZ    NOT NULL,
  event_processed_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX ON stock_movements (bling_sku, movement_type);
CREATE INDEX ON stock_movements (wms_ref) WHERE wms_ref IS NOT NULL;
CREATE INDEX ON stock_movements (bling_order_id);
CREATE INDEX ON stock_movements (event_processed_at) WHERE event_processed_at IS NULL;

-- ─── Stock snapshots (reconciliation cron only) ───────────────────────────────
-- Updated every 30 min by the cron. Never by webhooks.

CREATE TABLE stock_snapshots (
  bling_sku           TEXT        PRIMARY KEY REFERENCES product_mappings(bling_sku),
  balance             INTEGER     NOT NULL DEFAULT 0,   -- our delta-computed total
  wms_balance         INTEGER,                          -- authoritative from Smartgo
  last_reconciled_at  TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VIEW stock_divergences AS
SELECT
  s.bling_sku,
  pm.wms_codigo,
  s.balance              AS bling_balance,
  s.wms_balance          AS wms_balance,
  s.wms_balance - s.balance AS divergence,
  s.last_reconciled_at
FROM stock_snapshots s
JOIN product_mappings pm ON pm.bling_sku = s.bling_sku
WHERE s.wms_balance IS NOT NULL
  AND s.wms_balance != s.balance;

-- ─── Dead letter queue ────────────────────────────────────────────────────────

CREATE TABLE dead_letter_queue (
  id              BIGSERIAL   PRIMARY KEY,
  queue           TEXT        NOT NULL,
  job_id          TEXT        NOT NULL,
  job_name        TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  error_message   TEXT        NOT NULL,
  attempt_count   INTEGER     NOT NULL,
  first_failed_at TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT CHECK (resolution IN ('reprocessed','discarded'))
);
CREATE INDEX ON dead_letter_queue (resolved_at) WHERE resolved_at IS NULL;

-- ─── Audit log (immutable — no UPDATE/DELETE at app layer) ───────────────────

CREATE TABLE audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  actor       TEXT        NOT NULL,  -- JWT sub
  action      TEXT        NOT NULL,  -- 'dlq_reprocess' | 'dlq_discard'
  entity_type TEXT        NOT NULL,
  entity_id   BIGINT      NOT NULL,
  payload     JSONB       NOT NULL,  -- full state snapshot at action time
  reason      TEXT,                  -- mandatory for 'dlq_discard'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Queue lag metrics ────────────────────────────────────────────────────────

CREATE TABLE queue_metrics (
  id            BIGSERIAL   PRIMARY KEY,
  queue         TEXT        NOT NULL,
  job_id        TEXT        NOT NULL UNIQUE,
  received_at   TIMESTAMPTZ NOT NULL,
  processed_at  TIMESTAMPTZ,
  lag_ms        INTEGER,    -- set when processed_at is written
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON queue_metrics (queue, processed_at DESC);

-- Rolling average lag (last 100 jobs per queue) — used by /health
CREATE VIEW queue_lag_avg AS
SELECT
  queue,
  ROUND(AVG(lag_ms))                 AS avg_lag_ms,
  ROUND(AVG(lag_ms)) > 300000        AS above_threshold,  -- 5-min threshold
  MAX(processed_at)                  AS last_processed_at,
  COUNT(*) FILTER (WHERE lag_ms IS NULL) AS stalled_count
FROM (
  SELECT queue, lag_ms, processed_at
  FROM queue_metrics
  WHERE created_at > now() - INTERVAL '1 hour'
  ORDER BY created_at DESC
) recent
GROUP BY queue;

-- ─── pg_notify triggers (WebSocket → dashboard) ───────────────────────────────

CREATE OR REPLACE FUNCTION notify_dlq() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('dashboard', json_build_object(
    'event',    'dlq_new',
    'id',       NEW.id,
    'queue',    NEW.queue,
    'job_name', NEW.job_name,
    'payload',  NEW.payload,
    'created_at', NEW.created_at
  )::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_dlq_notify
  AFTER INSERT ON dead_letter_queue
  FOR EACH ROW EXECUTE FUNCTION notify_dlq();

CREATE OR REPLACE FUNCTION notify_movement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_processed_at IS NOT NULL AND OLD.event_processed_at IS NULL THEN
    PERFORM pg_notify('dashboard', json_build_object(
      'event',         'movement_processed',
      'id',            NEW.id,
      'bling_sku',     NEW.bling_sku,
      'movement_type', NEW.movement_type,
      'delta',         NEW.delta,
      'lag_ms',        EXTRACT(EPOCH FROM (NEW.event_processed_at - NEW.event_received_at)) * 1000
    )::text);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_movement_notify
  AFTER UPDATE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION notify_movement();

CREATE OR REPLACE FUNCTION notify_divergence() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.wms_balance IS NOT NULL
     AND (OLD.wms_balance IS DISTINCT FROM NEW.wms_balance OR OLD.balance IS DISTINCT FROM NEW.balance)
     AND NEW.wms_balance != NEW.balance
  THEN
    PERFORM pg_notify('dashboard', json_build_object(
      'event',       'divergence',
      'bling_sku',   NEW.bling_sku,
      'bling_bal',   NEW.balance,
      'wms_bal',     NEW.wms_balance,
      'divergence',  NEW.wms_balance - NEW.balance
    )::text);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_snapshot_notify
  AFTER INSERT OR UPDATE ON stock_snapshots
  FOR EACH ROW EXECUTE FUNCTION notify_divergence();

-- ─── Cleanup job (run daily via cron or pg_cron) ─────────────────────────────
-- Delete idempotency keys older than 30 days (events are long past replay window)
-- DELETE FROM idempotency_keys WHERE processed_at < now() - INTERVAL '30 days';
