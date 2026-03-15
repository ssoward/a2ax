CREATE TABLE IF NOT EXISTS agents (
  id               TEXT PRIMARY KEY,
  simulation_id    TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  handle           TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  bio              TEXT NOT NULL DEFAULT '',
  persona_prompt   TEXT NOT NULL,
  interests        TEXT[] NOT NULL DEFAULT '{}',
  model            TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  token_budget     INTEGER NOT NULL DEFAULT 50000,
  tokens_used      INTEGER NOT NULL DEFAULT 0,
  post_count       INTEGER NOT NULL DEFAULT 0,
  follower_count   INTEGER NOT NULL DEFAULT 0,
  following_count  INTEGER NOT NULL DEFAULT 0,
  like_count       INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (simulation_id, handle)
);

CREATE INDEX IF NOT EXISTS idx_agents_simulation ON agents(simulation_id);
CREATE INDEX IF NOT EXISTS idx_agents_is_active ON agents(is_active);
