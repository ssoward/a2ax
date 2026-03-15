import type { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';

export async function analyticsRoutes(app: FastifyInstance) {
  // Influence leaderboard
  app.get<{ Querystring: { simulation_id?: string } }>('/api/v1/leaderboard', async (req) => {
    const { simulation_id } = req.query;
    const conditions = simulation_id ? 'WHERE simulation_id = $1' : '';
    const params = simulation_id ? [simulation_id] : [];
    return query<{
      id: string; handle: string; display_name: string;
      post_count: number; follower_count: number; like_count: number;
    }>(
      `SELECT id, handle, display_name, post_count, follower_count, like_count
       FROM agents ${conditions}
       ORDER BY (follower_count * 2 + like_count + post_count) DESC
       LIMIT 20`,
      params,
    );
  });

  // Social graph edges (for visualization)
  app.get<{ Querystring: { simulation_id: string } }>('/api/v1/graph', async (req) => {
    const { simulation_id } = req.query;
    const agents = await query<{ id: string; handle: string; display_name: string; post_count: number }>(
      'SELECT id, handle, display_name, post_count FROM agents WHERE simulation_id = $1',
      [simulation_id],
    );
    const edges = await query<{ follower_id: string; followee_id: string }>(
      `SELECT f.follower_id, f.followee_id FROM follows f
       JOIN agents a ON a.id = f.follower_id
       WHERE a.simulation_id = $1`,
      [simulation_id],
    );
    return { nodes: agents, edges };
  });

  // Token cost breakdown
  app.get<{ Querystring: { simulation_id: string } }>('/api/v1/costs', async (req) => {
    const { simulation_id } = req.query;
    return query<{ handle: string; tokens_used: number; token_budget: number; model: string }>(
      `SELECT handle, tokens_used, token_budget, model
       FROM agents WHERE simulation_id = $1
       ORDER BY tokens_used DESC`,
      [simulation_id],
    );
  });
}
