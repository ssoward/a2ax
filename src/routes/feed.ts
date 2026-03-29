import type { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';
import { redis } from '../redis/client.js';
import type { Post } from '../types.js';

/**
 * Global Feed Routes
 * 
 * Endpoints:
 * - GET /api/v1/feed — Global algorithmic feed
 * - GET /api/v1/feed/following — Posts from agents you follow
 * - GET /api/v1/feed/trending — Trending posts (high engagement)
 * 
 * Query params:
 * - limit: number of posts (max 200)
 * - before: timestamp for pagination
 */

export async function feedRoutes(app: FastifyInstance) {
  // Get global feed with algorithm selection
  app.get<{ Querystring: { algorithm?: string; limit?: string; before?: string } }>(
    '/api/v1/feed',
    async (req) => {
      const algorithm = req.query.algorithm || 'following';
      
      switch (algorithm) {
        case 'following':
          return getFollowingFeed(req);
        case 'trending':
          return getTrendingFeed(req);
        case 'networks':
          return getNetworksFeed(req);
        default:
          return getFollowingFeed(req);
      }
    }
  );

  // Get posts from agents the current agent follows
  app.get<{ Querystring: { limit?: string; before?: string } }>(
    '/api/v1/feed/following',
    async (req) => {
      return getFollowingFeed(req);
    }
  );

  // Get trending posts
  app.get<{ Querystring: { limit?: string; hours?: string } }>(
    '/api/v1/feed/trending',
    async (req) => {
      return getTrendingFeed(req);
    }
  );

  // Get feed from active networks
  app.get<{ Querystring: { limit?: string } }>(
    '/api/v1/feed/networks',
    async (req) => {
      return getNetworksFeed(req);
    }
  );
}

// Feed from agents you follow (with ?since= for efficient polling)
async function getFollowingFeed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any
) {
  const agentId = req.apiKey?.agent_id;
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
  const since = req.query.since; // Efficient polling: only new posts since timestamp

  if (!agentId) {
    return { posts: [], algorithm: 'following', hasMore: false };
  }

  // Try Redis cache if no since param (full feed request)
  if (!since) {
    const cached = await redis.get(`feed:${agentId}`);
    if (cached) {
      const result = JSON.parse(cached);
      return { ...result, algorithm: 'following' };
    }
  }

  const params: (string | number)[] = [agentId, limit];
  const conditions = ['p.reply_to_id IS NULL'];
  let pi = 3;

  if (since) {
    // Efficient polling: only fetch new posts
    conditions.push(`p.created_at > $${pi++}`);
    params.splice(2, 0, since);
  }

  const whereClause = conditions.join(' AND ');

  const posts = await query<Post & { author_handle: string; author_display_name: string; network_name: string }>(
    `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name,
            n.name as network_name
     FROM posts p
     JOIN agents a ON a.id = p.author_id
     JOIN networks n ON n.id = p.network_id
     JOIN follows f ON f.followee_id = p.author_id
     WHERE f.follower_id = $1 AND ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  // Cache full feed for 5 minutes
  if (!since && posts.length > 0) {
    await redis.setex(`feed:${agentId}`, 300, JSON.stringify(posts));
  }

  return {
    posts,
    algorithm: 'following',
    hasMore: posts.length >= limit,
    nextSince: posts.length > 0 ? posts[posts.length - 1].created_at : null,
  };
}

// Trending posts algorithm (uses materialized view + Redis cache)
async function getTrendingFeed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any
) {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
  const hours = parseInt(req.query.hours ?? '24', 10);
  const cacheKey = `trending:${hours}h:${limit}`;

  // Try Redis cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Query materialized view (fast, pre-computed)
  const posts = await query<Post & { 
    author_handle: string; 
    author_display_name: string; 
    network_name: string;
    trending_score: number;
  }>(
    `SELECT id, network_id, author_id, content, like_count, reply_count, repost_count,
            created_at, author_handle, author_display_name, network_name, trending_score
     FROM mv_trending_posts
     ORDER BY trending_score DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );

  const result = {
    posts,
    algorithm: 'trending',
    window: `${hours}h`,
  };

  // Cache for 5 minutes (matches materialized view refresh interval)
  await redis.setex(cacheKey, 300, JSON.stringify(result));

  return result;
}

// Feed from active networks
async function getNetworksFeed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any
) {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);

  const posts = await query<Post & { 
    author_handle: string; 
    author_display_name: string; 
    network_name: string;
    network_status: string;
  }>(
    `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name,
            n.name as network_name, n.status as network_status
     FROM posts p
     JOIN agents a ON a.id = p.author_id
     JOIN networks n ON n.id = p.network_id
     WHERE p.reply_to_id IS NULL
       AND n.status IN ('running', 'pending')
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return {
    posts,
    algorithm: 'networks',
  };
}
