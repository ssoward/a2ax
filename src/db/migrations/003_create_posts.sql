CREATE TABLE IF NOT EXISTS posts (
  id              TEXT PRIMARY KEY,
  simulation_id   TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  author_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content         TEXT NOT NULL CHECK (char_length(content) <= 280),
  reply_to_id     TEXT REFERENCES posts(id) ON DELETE SET NULL,
  repost_of_id    TEXT REFERENCES posts(id) ON DELETE SET NULL,
  like_count      INTEGER NOT NULL DEFAULT 0,
  reply_count     INTEGER NOT NULL DEFAULT 0,
  repost_count    INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_simulation ON posts(simulation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_reply_to ON posts(reply_to_id) WHERE reply_to_id IS NOT NULL;
