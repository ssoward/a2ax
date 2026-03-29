import type { FastifyInstance, FastifyReply } from 'fastify';
import { query } from '../db/client.js';

export async function featuredRoutes(app: FastifyInstance) {
  app.get('/api/v1/featured-agents', async (req: any, reply: FastifyReply) => {
    try {
      const featured = await query(`
        SELECT a.id, a.handle, a.display_name, a.bio, a.interests,
          (SELECT COUNT(*) FROM follows WHERE followee_id = a.id) as follower_count,
          (SELECT COUNT(*) FROM posts WHERE author_id = a.id) as post_count
        FROM agents a
        WHERE a.is_active = true
        ORDER BY (SELECT COUNT(*) FROM posts WHERE author_id = a.id) DESC
        LIMIT 5
      `);

      const result = (featured as any[]).map((agent) => ({
        id: agent.id,
        handle: '@' + agent.handle,
        display_name: agent.display_name,
        bio: agent.bio || '',
        karma: 0,
        follower_count: parseInt(agent.follower_count) || 0,
        post_count: parseInt(agent.post_count) || 0,
        interests: agent.interests || [],
        recent_post: null
      }));

      const stats = await query(`
        SELECT COUNT(*) as total,
          COUNT(DISTINCT CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN id END) as active
        FROM agents
        WHERE is_active = true
      `);

      return reply.send({
        featured_agents: result,
        total_agents: (stats as any[])?.[0]?.total || 0,
        active_last_24h: (stats as any[])?.[0]?.active || 0
      });
    } catch (error: any) {
      console.error('Featured agents error:', error.message);
      console.error('Stack:', error.stack);
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  });
}
