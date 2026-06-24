-- SyncStock — initial schema
-- All timestamps are TIMESTAMPTZ (UTC stored, tz-aware)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── events ────────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT        NOT NULL UNIQUE,
  origin          TEXT        NOT NULL CHECK (origin IN ('bling','wms')),
  event_type      TEXT        NOT NULL,
  entity_id       TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processing','success','failed','dlq')),
  retry_count     INT         NOT NULL DEFAULT 0,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  error_message   TEXT,
  queue_name      TEXT        NOT NULL
);

CREATE INDEX idx_events_status     ON events (status);
CREATE INDEX idx_events_origin     ON events (origin, event_type);
CREATE INDEX idx_events_entity     ON events (entity_id);
CREATE INDEX idx_events_received   ON events (received_at DESC);

-- ── idempotency_keys (fast lookup, mirrors events.idempotency_key) ────────────
CREATE TABLE idempotency_keys (
  key        TEXT PRIMARY KEY,
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── stock_movements ───────────────────────────────────────────────────────────
-- Webhook events write deltas here. Absolute balance lives only in snapshots.
CREATE TABLE stock_movements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL REFERENCES events(id),
  sku             TEXT        NOT NULL,
  company_id      TEXT        NOT NULL,
  delta           INT         NOT NULL,
  movement_type   TEXT        NOT NULL CHECK (movement_type IN ('reservation','physical','adjustment')),
  reservation_id  UUID,       -- physical dispatch references its reservation row
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB
);

CREATE INDEX idx_movements_sku    ON stock_movements (sku, company_id);
CREATE INDEX idx_movements_event  ON stock_movements (event_id);
CREATE INDEX idx_movements_type   ON stock_movements (movement_type);

-- ── stock_snapshots ───────────────────────────────────────────────────────────
-- Updated ONLY by the reconciliation cron (every 30 min). Never by webhooks.
CREATE TABLE stock_snapshots (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                 TEXT        NOT NULL,
  company_id          TEXT        NOT NULL,
  balance_bling       INT         NOT NULL DEFAULT 0,
  balance_wms         INT         NOT NULL DEFAULT 0,
  last_reconciled_at  TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku, company_id)
);

-- ── product_mappings ──────────────────────────────────────────────────────────
-- Three states: pending (awaiting approval), approved (sync active),
-- quarantine (ambiguous match — excluded from sync, surfaces as dashboard alert)
CREATE TABLE product_mappings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_bling         TEXT        NOT NULL,
  sku_wms           TEXT,
  company_id        TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','approved','quarantine')),
  confidence        NUMERIC(5,2),
  quarantine_reason TEXT,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku_bling, company_id)
);

CREATE INDEX idx_mappings_status ON product_mappings (status);

-- ── dead_letter_queue ─────────────────────────────────────────────────────────
-- Events that exhausted all retries. Operator must reprocess or discard.
CREATE TABLE dead_letter_queue (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID        NOT NULL REFERENCES events(id),
  origin            TEXT        NOT NULL,
  event_type        TEXT        NOT NULL,
  entity_id         TEXT        NOT NULL,
  payload           JSONB       NOT NULL,
  error_message     TEXT,
  retry_count       INT         NOT NULL,
  queued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  resolution        TEXT        CHECK (resolution IN ('reprocessed','discarded')),
  resolution_reason TEXT,
  resolved_by       TEXT
);

CREATE INDEX idx_dlq_resolved ON dead_letter_queue (resolved_at) WHERE resolved_at IS NULL;

-- ── audit_log (append-only — no UPDATE/DELETE allowed via policy) ─────────────
CREATE TABLE audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action      TEXT        NOT NULL,
  entity_type TEXT        NOT NULL,
  entity_id   TEXT        NOT NULL,
  actor       TEXT        NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);

-- Prevent modifications to audit_log
CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- ── pg_notify triggers ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_event_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('syncstock_events', json_build_object(
    'id',         NEW.id,
    'status',     NEW.status,
    'origin',     NEW.origin,
    'event_type', NEW.event_type,
    'entity_id',  NEW.entity_id,
    'received_at',NEW.received_at
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_events_notify
  AFTER INSERT OR UPDATE OF status ON events
  FOR EACH ROW EXECUTE FUNCTION notify_event_change();

CREATE OR REPLACE FUNCTION notify_dlq_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('syncstock_dlq', json_build_object(
    'id',            NEW.id,
    'event_id',      NEW.event_id,
    'origin',        NEW.origin,
    'event_type',    NEW.event_type,
    'entity_id',     NEW.entity_id,
    'error_message', NEW.error_message,
    'retry_count',   NEW.retry_count,
    'queued_at',     NEW.queued_at,
    'resolution',    NEW.resolution
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dlq_notify
  AFTER INSERT OR UPDATE OF resolution ON dead_letter_queue
  FOR EACH ROW EXECUTE FUNCTION notify_dlq_change();

CREATE OR REPLACE FUNCTION notify_mapping_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('syncstock_mappings', json_build_object(
    'id',         NEW.id,
    'sku_bling',  NEW.sku_bling,
    'sku_wms',    NEW.sku_wms,
    'company_id', NEW.company_id,
    'status',     NEW.status
  )::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_mappings_notify
  AFTER INSERT OR UPDATE OF status ON product_mappings
  FOR EACH ROW EXECUTE FUNCTION notify_mapping_change();
