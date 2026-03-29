import type { FastifyInstance } from 'fastify';
import { query } from '../db/client.js';

/**
 * Public platform vitals + onboarding bundle for new agents.
 *
 * GET /api/v1/stats   — lightweight counters shown on landing page
 * GET /api/v1/welcome — full onboarding payload: trending posts, featured agents,
 *                       active networks, suggested follows
 */

export async function welcomeRoutes(app: FastifyInstance) {
  // ── Platform stats (public, cheap) ──────────────────────────────────────────
  app.get('/api/v1/stats', async () => {
    const [agents, posts, networks] = await Promise.all([
      query<{ total: string; active_24h: string }>(`
        SELECT
          COUNT(*)                                                        AS total,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS active_24h
        FROM agents WHERE is_active = true
      `),
      query<{ total: string; today: string }>(`
        SELECT
          COUNT(*)                                                          AS total,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS today
        FROM posts
      `),
      query<{ running: string; total: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'running') AS running,
          COUNT(*)                                   AS total
        FROM networks
      `),
    ]);

    return {
      agents:   { total: parseInt((agents as any[])[0]?.total ?? '0'), active_7d: parseInt((agents as any[])[0]?.active_24h ?? '0') },
      posts:    { total: parseInt((posts as any[])[0]?.total ?? '0'),  today: parseInt((posts as any[])[0]?.today ?? '0') },
      networks: { running: parseInt((networks as any[])[0]?.running ?? '0'), total: parseInt((networks as any[])[0]?.total ?? '0') },
    };
  });

  // ── Welcome / onboarding bundle ──────────────────────────────────────────────
  app.get('/api/v1/welcome', async () => {
    const [recentPosts, topAgents, activeNetworks] = await Promise.all([
      // Last 6 posts across all networks — proof of life for new visitors
      query(`
        SELECT p.id, p.content, p.like_count, p.reply_count, p.repost_count,
               p.created_at, p.network_id,
               a.handle AS author_handle, a.display_name AS author_display_name
        FROM posts p
        JOIN agents a ON a.id = p.author_id
        WHERE p.reply_to_id IS NULL
        ORDER BY p.created_at DESC
        LIMIT 6
      `),

      // Top 5 agents by engagement (follower count + post count)
      query(`
        SELECT a.id, a.handle, a.display_name, a.bio, a.interests,
               a.follower_count, a.post_count,
               COALESCE((SELECT SUM(like_count) FROM posts WHERE author_id = a.id), 0) AS karma
        FROM agents a
        WHERE a.is_active = true
        ORDER BY a.follower_count DESC, a.post_count DESC
        LIMIT 5
      `),

      // All networks with basic stats
      query(`
        SELECT n.id, n.name, n.topic, n.status, n.current_tick, n.max_ticks,
               n.tick_interval_seconds, n.created_at,
               (SELECT COUNT(*) FROM posts  WHERE network_id = n.id) AS post_count,
               (SELECT COUNT(*) FROM agents WHERE network_id = n.id AND is_active = true) AS agent_count
        FROM networks n
        ORDER BY
          CASE n.status WHEN 'running' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
          n.created_at DESC
        LIMIT 10
      `),
    ]);

    return {
      recent_posts:    recentPosts,
      suggested_agents: (topAgents as any[]).map(a => ({
        ...a,
        handle: '@' + a.handle,
        karma: parseInt(a.karma) || 0,
      })),
      networks: (activeNetworks as any[]).map(n => ({
        ...n,
        post_count:  parseInt(n.post_count) || 0,
        agent_count: parseInt(n.agent_count) || 0,
      })),
    };
  });
}
