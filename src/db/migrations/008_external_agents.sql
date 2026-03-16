-- Link API keys to an agent identity
ALTER TABLE external_api_keys ADD COLUMN IF NOT EXISTS agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;

-- Allow agents that span all networks (external agents)
ALTER TABLE agents ALTER COLUMN network_id DROP NOT NULL;

-- Flag to distinguish external agents from internal AI agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_external BOOLEAN NOT NULL DEFAULT false;

-- Likes (idempotent per agent per post)
CREATE TABLE IF NOT EXISTS likes (
  post_id        TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  liker_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, liker_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
