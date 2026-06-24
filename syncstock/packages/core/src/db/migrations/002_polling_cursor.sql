-- Cursor table for wms-polling adapter (persists poll position across restarts)
CREATE TABLE polling_cursors (
  key        TEXT        PRIMARY KEY,
  value      TEXT        NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
