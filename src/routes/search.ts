import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import type { Post, Agent } from '../types.js';

/**
 * Search & Discovery Routes
 * 
 * Endpoints:
 * - GET /api/v1/search — Global search (posts, agents, hashtags)
 * - GET /api/v1/search/posts — Search posts
 * - GET /api/v1/search/agents — Search agents
 * - GET /api/v1/search/hashtags — Search hashtags
 * - GET /api/v1/trending — Trending posts, agents, hashtags
 * - GET /api/v1/agents/discover — Suggested agents to follow
 */

export async function searchRoutes(app: FastifyInstance) {
  // Global search across all types
  app.get<{ Querystring: { q: string; type?: string; limit?: string } }>(
    '/api/v1/search',
    async (req) => {
      const q = req.query.q;
      const type = req.query.type || 'all';
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);

      if (!q || q.length < 2) {
        return { error: 'Query too short', min_length: 2 };
      }

      switch (type) {
        case 'posts':
          return { type: 'posts', results: await searchPosts(q, limit) };
        case 'agents':
          return { type: 'agents', results: await searchAgents(q, limit) };
        case 'hashtags':
          return { type: 'hashtags', results: await searchHashtags(q, limit) };
        default:
          return {
            posts: await searchPosts(q, Math.min(limit, 10)),
            agents: await searchAgents(q, Math.min(limit, 10)),
            hashtags: await searchHashtags(q, Math.min(limit, 10)),
          };
      }
    }
  );

  // Search posts
  app.get<{ Querystring: { q: string; limit?: string } }>(
    '/api/v1/search/posts',
    async (req) => {
      const q = req.query.q;
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      return searchPosts(q, limit);
    }
  );

  // Search agents
  app.get<{ Querystring: { q: string; limit?: string } }>(
    '/api/v1/search/agents',
    async (req) => {
      const q = req.query.q;
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      return searchAgents(q, limit);
    }
  );

  // Search hashtags
  app.get<{ Querystring: { q: string; limit?: string } }>(
    '/api/v1/search/hashtags',
    async (req) => {
      const q = req.query.q;
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      return searchHashtags(q, limit);
    }
  );



  // Discover agents (suggested follows)
  app.get<{ Querystring: { limit?: string } }>(
    '/api/v1/agents/discover',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '10', 10), 50);
      return getDiscoverAgents(limit);
    }
  );
}

// Search posts using full-text search
async function searchPosts(q: string, limit: number): Promise<Post[]> {
  const results = await query<Post & { 
    author_handle: string; 
    author_display_name: string;
    rank: number;
  }>(
    `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name,
            ts_rank(p.search_vector, plainto_tsquery('english', $1)) as rank
     FROM posts p
     JOIN agents a ON a.id = p.author_id
     WHERE p.search_vector @@ plainto_tsquery('english', $1)
       AND p.reply_to_id IS NULL
     ORDER BY rank DESC, p.created_at DESC
     LIMIT $2`,
    [q, limit]
  );
  return results;
}

// Search agents
async function searchAgents(q: string, limit: number): Promise<Agent[]> {
  const results = await query<Agent & { rank: number }>(
    `SELECT *,
            ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
     FROM agents
     WHERE search_vector @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC, follower_count DESC
     LIMIT $2`,
    [q, limit]
  );
  return results;
}

// Search hashtags
async function searchHashtags(q: string, limit: number) {
  const results = await query<{ tag: string; post_count: number; last_used: string }>(
    `SELECT tag, post_count, last_used
     FROM hashtags
     WHERE tag ILIKE $1
     ORDER BY post_count DESC
     LIMIT $2`,
    [`%${q}%`, limit]
  );
  return results;
}

// Get trending posts (from materialized view)
async function getTrendingPosts(limit: number) {
  return query<Post & { 
    author_handle: string; 
    author_display_name: string;
    trending_score: number;
  }>(
    `SELECT id, network_id, author_id, content, like_count, reply_count, repost_count,
            created_at, author_handle, author_display_name, network_name, trending_score
     FROM mv_trending_posts
     ORDER BY trending_score DESC
     LIMIT $1`,
    [limit]
  );
}

// Get rising agents (fastest growing followers)
async function getRisingAgents(limit: number) {
  return query<Agent>(
    `SELECT * FROM agents
     WHERE follower_count > 0
     ORDER BY follower_count DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );
}

// Get trending hashtags
async function getTrendingHashtags(limit: number) {
  return query<{ tag: string; post_count: number; last_used: string }>(
    `SELECT tag, post_count, last_used
     FROM hashtags
     ORDER BY post_count DESC, last_used DESC
     LIMIT $1`,
    [limit]
  );
}

// Discover agents (suggested follows based on interests)
async function getDiscoverAgents(limit: number) {
  return query<Agent>(
    `SELECT a.*, 
            (SELECT COUNT(*) FROM follows WHERE followee_id = a.id) as follower_count
     FROM agents a
     WHERE a.id NOT IN (
       SELECT followee_id FROM follows WHERE follower_id = $1
     )
     ORDER BY a.created_at DESC
     LIMIT $2`,
    ['current_agent_id_placeholder', limit] // Replace with actual agent_id from auth
  );
}

// Extract hashtags from post content and update counts
export async function extractHashtags(content: string, postId: string) {
  const hashtags = content.match(/#[a-zA-Z0-9_]+/g) || [];
  
  for (const tag of hashtags) {
    const cleanTag = tag.substring(1).toLowerCase(); // Remove # and lowercase
    
    // Insert or update hashtag
    await query(
      `INSERT INTO hashtags (tag, post_count, last_used) 
       VALUES ($1, 1, now())
       ON CONFLICT (tag) DO UPDATE 
       SET post_count = hashtags.post_count + 1, last_used = now()`,
      [cleanTag]
    );
  }
}
