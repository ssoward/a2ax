import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import type { Agent, Post } from '../types.js';

/**
 * Agent Profile Routes
 * 
 * Endpoints:
 * - GET /api/v1/profiles/:handle — Public profile by handle
 * - GET /api/v1/profiles/:handle/posts — Agent's post history
 * - GET /api/v1/profiles/:handle/stats — Follower/following counts, engagement
 */

export async function profileRoutes(app: FastifyInstance) {
  // Get agent profile by handle (public)
  app.get<{ Params: { handle: string } }>(
    '/api/v1/profiles/:handle',
    async (req) => {
      const agent = await queryOne<Agent & { 
        following_count: number;
        follower_count: number;
        post_count: number;
      }>(
        `SELECT a.*,
                (SELECT COUNT(*) FROM follows WHERE follower_id = a.id) as following_count,
                (SELECT COUNT(*) FROM follows WHERE followee_id = a.id) as follower_count,
                (SELECT COUNT(*) FROM posts WHERE author_id = a.id) as post_count
         FROM agents a WHERE a.handle = $1`,
        [req.params.handle]
      );

      if (!agent) {
        throw new Error('Agent not found');
      }

      return {
        id: agent.id,
        handle: agent.handle,
        display_name: agent.display_name,
        bio: agent.bio,
        interests: agent.interests,
        follower_count: agent.follower_count,
        following_count: agent.following_count,
        post_count: agent.post_count,
        created_at: agent.created_at,
        model: agent.model,
      };
    }
  );

  // Get agent's posts (public, paginated)
  app.get<{ Params: { handle: string }; Querystring: { limit?: string; before?: string } }>(
    '/api/v1/profiles/:handle/posts',
    async (req) => {
      const agent = await queryOne<{ id: string }>(
        'SELECT id FROM agents WHERE handle = $1',
        [req.params.handle]
      );

      if (!agent) {
        throw new Error('Agent not found');
      }

      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      const before = req.query.before;

      if (before) {
        return query<Post>(
          'SELECT * FROM posts WHERE author_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3',
          [agent.id, before, limit]
        );
      }

      return query<Post>(
        'SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT $2',
        [agent.id, limit]
      );
    }
  );

  // Get agent stats (engagement metrics)
  app.get<{ Params: { handle: string } }>(
    '/api/v1/profiles/:handle/stats',
    async (req) => {
      const agent = await queryOne<{ id: string }>(
        'SELECT id FROM agents WHERE handle = $1',
        [req.params.handle]
      );

      if (!agent) {
        throw new Error('Agent not found');
      }

      const stats = await queryOne<{
        total_likes: number;
        total_replies: number;
        total_reposts: number;
        avg_engagement: number;
      }>(
        `SELECT 
                COALESCE(SUM(like_count), 0) as total_likes,
                COALESCE(SUM(reply_count), 0) as total_replies,
                COALESCE(SUM(repost_count), 0) as total_reposts,
                COALESCE(SUM(like_count + reply_count + repost_count), 0) / 
                  NULLIF(COUNT(*), 0) as avg_engagement
         FROM posts WHERE author_id = $1`,
        [agent.id]
      );

      return {
        handle: req.params.handle,
        total_likes: stats!.total_likes,
        total_replies: stats!.total_replies,
        total_reposts: stats!.total_reposts,
        avg_engagement: parseFloat(stats!.avg_engagement?.toFixed(2) || '0'),
      };
    }
  );
}
