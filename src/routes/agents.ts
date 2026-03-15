import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import type { Agent, Post } from '../types.js';
import { env } from '../env.js';

export async function agentsRoutes(app: FastifyInstance) {
  // List agents (optionally filtered by simulation)
  app.get<{ Querystring: { simulation_id?: string } }>('/api/v1/agents', async (req) => {
    const { simulation_id } = req.query;
    if (simulation_id) {
      return query<Agent>(
        'SELECT * FROM agents WHERE simulation_id = $1 ORDER BY post_count DESC',
        [simulation_id],
      );
    }
    return query<Agent>('SELECT * FROM agents ORDER BY created_at DESC LIMIT 100');
  });

  // Get agent
  app.get<{ Params: { id: string } }>('/api/v1/agents/:id', async (req) => {
    const agent = await queryOne<Agent>(
      `SELECT a.*,
         (SELECT COUNT(*) FROM follows WHERE follower_id = a.id) as following_count,
         (SELECT COUNT(*) FROM follows WHERE followee_id = a.id) as follower_count
       FROM agents a WHERE a.id = $1`,
      [req.params.id],
    );
    if (!agent) throw Errors.NOT_FOUND('Agent');
    return agent;
  });

  // Create agent
  app.post<{
    Body: {
      simulation_id: string;
      handle: string;
      display_name: string;
      bio: string;
      persona_prompt: string;
      interests: string[];
      model?: string;
      token_budget?: number;
    };
  }>('/api/v1/agents', async (req) => {
    const {
      simulation_id, handle, display_name, bio,
      persona_prompt, interests, model, token_budget,
    } = req.body;

    const id = newId.agent();
    await query(
      `INSERT INTO agents
         (id, simulation_id, handle, display_name, bio, persona_prompt, interests, model, token_budget)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id, simulation_id, handle, display_name, bio, persona_prompt,
        interests, model ?? 'claude-haiku-4-5-20251001',
        token_budget ?? env.DEFAULT_AGENT_TOKEN_BUDGET,
      ],
    );
    return queryOne<Agent>('SELECT * FROM agents WHERE id = $1', [id]);
  });

  // Get agent's posts
  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    '/api/v1/agents/:id/posts',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      const before = req.query.before;
      if (before) {
        return query<Post>(
          'SELECT * FROM posts WHERE author_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3',
          [req.params.id, before, limit],
        );
      }
      return query<Post>(
        'SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT $2',
        [req.params.id, limit],
      );
    },
  );

  // Get agent's feed
  app.get<{ Params: { id: string } }>('/api/v1/agents/:id/feed', async (req) => {
    const agentId = req.params.id;
    const agent = await queryOne<Agent>('SELECT simulation_id FROM agents WHERE id = $1', [agentId]);
    if (!agent) throw Errors.NOT_FOUND('Agent');

    const feed = await query<Post & { author_handle: string; author_display_name: string }>(
      `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON a.id = p.author_id
       JOIN follows f ON f.followee_id = p.author_id
       WHERE f.follower_id = $1
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [agentId],
    );
    return feed;
  });

  // Get agent's follows
  app.get<{ Params: { id: string } }>('/api/v1/agents/:id/following', async (req) => {
    return query<Agent>(
      `SELECT a.* FROM agents a
       JOIN follows f ON f.followee_id = a.id
       WHERE f.follower_id = $1`,
      [req.params.id],
    );
  });

  app.get<{ Params: { id: string } }>('/api/v1/agents/:id/followers', async (req) => {
    return query<Agent>(
      `SELECT a.* FROM agents a
       JOIN follows f ON f.follower_id = a.id
       WHERE f.followee_id = $1`,
      [req.params.id],
    );
  });
}
