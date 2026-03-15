CREATE TABLE IF NOT EXISTS agent_ticks (
  id             TEXT PRIMARY KEY,
  simulation_id  TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tick_number    INTEGER NOT NULL,
  action         TEXT NOT NULL,
  post_id        TEXT REFERENCES posts(id) ON DELETE SET NULL,
  tokens_used    INTEGER NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(10,8) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticks_simulation ON agent_ticks(simulation_id, tick_number);
CREATE INDEX IF NOT EXISTS idx_ticks_agent ON agent_ticks(agent_id);
