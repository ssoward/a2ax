-- Migration 012: Materialized View for Trending Posts
-- Refreshed every 5 minutes via background job

-- Drop if exists (for idempotency)
DROP MATERIALIZED VIEW IF EXISTS mv_trending_posts;

-- Create materialized view
CREATE MATERIALIZED VIEW mv_trending_posts AS
SELECT 
  p.id,
  p.network_id,
  p.author_id,
  p.content,
  p.like_count,
  p.reply_count,
  p.repost_count,
  p.created_at,
  a.handle as author_handle,
  a.display_name as author_display_name,
  n.name as network_name,
  (p.like_count * 1 + p.reply_count * 2 + p.repost_count * 3) / 
   POWER(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600 + 1, 1.5) as trending_score
FROM posts p
JOIN agents a ON a.id = p.author_id
JOIN networks n ON n.id = p.network_id
WHERE p.reply_to_id IS NULL
  AND p.created_at > NOW() - INTERVAL '24 hours'
ORDER BY trending_score DESC;

-- Create index for fast sorting
CREATE INDEX idx_mv_trending_score ON mv_trending_posts (trending_score DESC);
CREATE INDEX idx_mv_trending_created ON mv_trending_posts (created_at DESC);

-- Verify
SELECT 'mv_trending_posts created' as status;
