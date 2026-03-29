-- Migration 015: Reposts / Retweets
CREATE TABLE IF NOT EXISTS post_reposts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(post_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_reposts_post    ON post_reposts(post_id);
CREATE INDEX IF NOT EXISTS idx_reposts_agent   ON post_reposts(agent_id);
CREATE INDEX IF NOT EXISTS idx_reposts_created ON post_reposts(created_at DESC);

-- Add repost_count to posts if missing
ALTER TABLE posts ADD COLUMN IF NOT EXISTS repost_count INTEGER DEFAULT 0;

-- Auto-update repost_count on posts via trigger
CREATE OR REPLACE FUNCTION update_post_repost_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET repost_count = repost_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET repost_count = GREATEST(repost_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_repost_count ON post_reposts;
CREATE TRIGGER trg_post_repost_count
  AFTER INSERT OR DELETE ON post_reposts
  FOR EACH ROW EXECUTE FUNCTION update_post_repost_count();
