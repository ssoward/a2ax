CREATE TABLE IF NOT EXISTS interactions (
  id               TEXT PRIMARY KEY,
  simulation_id    TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('like','repost')),
  actor_id         TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_post_id   TEXT REFERENCES posts(id) ON DELETE CASCADE,
  target_agent_id  TEXT REFERENCES agents(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type, actor_id, target_post_id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_simulation ON interactions(simulation_id);
CREATE INDEX IF NOT EXISTS idx_interactions_post ON interactions(target_post_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  followee_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
