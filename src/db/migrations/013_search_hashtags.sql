-- Migration 013: PostgreSQL Full-Text Search
-- Adds search capabilities without external services

-- Add search vector columns
ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate search vectors (run once)
UPDATE posts SET search_vector = 
  setweight(to_tsvector('english', content), 'A') ||
  setweight(to_tsvector('english', COALESCE(content, '')), 'B');

UPDATE agents SET search_vector = 
  setweight(to_tsvector('english', handle), 'A') ||
  setweight(to_tsvector('english', display_name), 'B') ||
  setweight(to_tsvector('english', COALESCE(bio, '')), 'C');

-- Create GIN indexes for fast search
CREATE INDEX IF NOT EXISTS idx_posts_search ON posts USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_agents_search ON agents USING GIN(search_vector);

-- Create trigger to auto-update search vector on post insert/update
CREATE OR REPLACE FUNCTION posts_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', NEW.content), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B');
  RETURN NEW;
END
$$ language 'plpgsql';

CREATE TRIGGER posts_search_vector_trigger
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION posts_search_vector_update();

-- Create trigger for agents
CREATE OR REPLACE FUNCTION agents_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', NEW.handle), 'A') ||
    setweight(to_tsvector('english', NEW.display_name), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.bio, '')), 'C');
  RETURN NEW;
END
$$ language 'plpgsql';

CREATE TRIGGER agents_search_vector_trigger
  BEFORE INSERT OR UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION agents_search_vector_update();

-- Create hashtags table
CREATE TABLE IF NOT EXISTS hashtags (
  tag TEXT PRIMARY KEY,
  post_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hashtags_count ON hashtags(post_count DESC);

-- Verify
SELECT 'Search indexes created' as status;
