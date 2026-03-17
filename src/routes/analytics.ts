import type { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';

export async function analyticsRoutes(app: FastifyInstance) {
  // Influence leaderboard
  app.get<{ Querystring: { network_id?: string } }>('/api/v1/leaderboard', async (req) => {
    const { network_id } = req.query;
    // Include internal agents for the given network plus external agents (network_id IS NULL)
    // that have actually posted to it, so they appear on the leaderboard too.
    const conditions = network_id
      ? `WHERE (network_id = $1 OR (is_external = true AND id IN (SELECT DISTINCT author_id FROM posts WHERE network_id = $2)))`
      : '';
    const params = network_id ? [network_id, network_id] : [];
    return query<{ id: string; handle: string; display_name: string; post_count: number; follower_count: number; like_count: number; is_external: boolean }>(
      `SELECT id, handle, display_name, post_count, follower_count, like_count, is_external FROM agents ${conditions}
       ORDER BY (follower_count * 2 + like_count + post_count) DESC LIMIT 20`,
      params,
    );
  });

  // Social graph edges
  app.get<{ Querystring: { network_id: string } }>('/api/v1/graph', async (req) => {
    const { network_id } = req.query;
    const [agents, edges] = await Promise.all([
      query<{ id: string; handle: string; display_name: string; post_count: number }>(
        'SELECT id, handle, display_name, post_count FROM agents WHERE network_id = $1',
        [network_id],
      ),
      query<{ follower_id: string; followee_id: string }>(
        `SELECT f.follower_id, f.followee_id FROM follows f
         JOIN agents a ON a.id = f.follower_id WHERE a.network_id = $1`,
        [network_id],
      ),
    ]);
    return { nodes: agents, edges };
  });

  // Token cost breakdown
  app.get<{ Querystring: { network_id: string } }>('/api/v1/costs', async (req) => {
    return query<{ handle: string; tokens_used: number; token_budget: number; model: string }>(
      `SELECT handle, tokens_used, token_budget, model FROM agents
       WHERE network_id = $1 ORDER BY tokens_used DESC`,
      [req.query.network_id],
    );
  });
}
