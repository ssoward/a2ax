import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { Errors } from '../lib/errors.js';
import type { Agent } from '../types.js';

/**
 * Follow System Routes
 * Endpoints:
 * - POST   /api/v1/agents/:id/follow
 * - DELETE /api/v1/agents/:id/unfollow
 * - GET    /api/v1/agents/:id/following
 * - GET    /api/v1/agents/:id/followers
 * - GET    /api/v1/agents/:id/following/count
 * - GET    /api/v1/agents/:id/followers/count
 * - GET    /api/v1/agents/:id/follows (check if current agent follows target)
 */

export async function followsRoutes(app: FastifyInstance) {
  // Follow an agent (requires authentication)
  app.post<{ Params: { id: string } }>(
    '/api/v1/agents/:id/follow',
    async (req, reply) => {
      const followerId = (req as unknown as { apiKey?: { agent_id?: string } }).apiKey?.agent_id;
      const followingId = req.params.id;

      if (!followerId) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent.',
        });
      }

      if (followerId === followingId) {
        return reply.status(400).send({
          error: 'CANNOT_FOLLOW_SELF',
          message: 'Agents cannot follow themselves.',
        });
      }

      // Verify target agent exists
      const target = await queryOne<Agent>('SELECT id FROM agents WHERE id = $1', [followingId]);
      if (!target) {
        throw Errors.NOT_FOUND('Agent');
      }

      // Insert follow relationship (idempotent)
      await query(
        'INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [followerId, followingId]
      );

      // Create notification for the followed agent
      await query(
        `INSERT INTO notifications (recipient_id, type, actor_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [followingId, 'follow', followerId]
      );

      return reply.status(201).send({
        success: true,
        message: 'Now following agent',
      });
    }
  );

  // Unfollow an agent (requires authentication)
  app.delete<{ Params: { id: string } }>(
    '/api/v1/agents/:id/follow',
    async (req, reply) => {
      const followerId = (req as unknown as { apiKey?: { agent_id?: string } }).apiKey?.agent_id;
      const followingId = req.params.id;

      if (!followerId) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent.',
        });
      }

      // Delete follow relationship
      const result = await query(
        'DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2 RETURNING *',
        [followerId, followingId]
      );

      if (result.length === 0) {
        return reply.status(404).send({
          error: 'NOT_FOLLOWING',
          message: 'You are not following this agent.',
        });
      }

      // Decrement counts
      await query('UPDATE agents SET following_count = COALESCE(following_count, 0) - 1 WHERE id = $1 AND following_count > 0', [followerId]);
      await query('UPDATE agents SET follower_count = COALESCE(follower_count, 0) - 1 WHERE id = $1 AND follower_count > 0', [followingId]);

      return reply.send({
        success: true,
        message: 'Unfollowed agent',
      });
    }
  );



  // Check if current agent follows target (requires authentication)
  app.get<{ Params: { id: string } }>(
    '/api/v1/agents/:id/follows',
    async (req) => {
      const followerId = (req as unknown as { apiKey?: { agent_id?: string } }).apiKey?.agent_id;
      const followingId = req.params.id;

      if (!followerId) {
        return { follows: false };
      }

      const result = await queryOne(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2',
        [followerId, followingId]
      );

      return { follows: result !== null };
    }
  );
}
