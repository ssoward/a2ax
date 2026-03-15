CREATE TABLE IF NOT EXISTS simulations (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  scenario                 TEXT NOT NULL DEFAULT '',
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','running','paused','completed')),
  tick_interval_seconds    INTEGER NOT NULL DEFAULT 30,
  max_ticks                INTEGER NOT NULL DEFAULT 100,
  current_tick             INTEGER NOT NULL DEFAULT 0,
  total_tokens_used        INTEGER NOT NULL DEFAULT 0,
  total_cost_usd           NUMERIC(10,6) NOT NULL DEFAULT 0,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
