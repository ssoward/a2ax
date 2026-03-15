import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import { scheduleNetwork, cancelNetworkTicks } from '../jobs/network-runner.js';
import { pubsub } from '../redis/client.js';
import type { Network, Agent } from '../types.js';
import { env } from '../env.js';
import { openSseConnections } from '../app.js';

const MAX_SSE_CONNECTIONS = 50;

const createNetworkSchema = {
  body: {
    type: 'object',
    required: ['name', 'topic'],
    additionalProperties: false,
    properties: {
      name:                  { type: 'string', minLength: 1, maxLength: 100 },
      topic:                 { type: 'string', minLength: 1, maxLength: 500 },
      tick_interval_seconds: { type: 'integer', minimum: 10, maximum: 3600 },
      max_ticks:             { type: 'integer', minimum: 1, maximum: 500 },
    },
  },
};

export async function networksRoutes(app: FastifyInstance) {
  // List networks
  app.get('/api/v1/networks', async () => {
    return query<Network>('SELECT * FROM networks ORDER BY created_at DESC');
  });

  // Get network
  app.get<{ Params: { id: string } }>('/api/v1/networks/:id', async (req) => {
    const net = await queryOne<Network>('SELECT * FROM networks WHERE id = $1', [req.params.id]);
    if (!net) throw Errors.NOT_FOUND('Network');
    return net;
  });

  // Create network (admin only — enforced in app.ts)
  app.post<{ Body: { name: string; topic: string; tick_interval_seconds?: number; max_ticks?: number } }>(
    '/api/v1/networks',
    { schema: createNetworkSchema },
    async (req) => {
      const { name, topic, tick_interval_seconds, max_ticks } = req.body;
      const id = newId.network();
      await query(
        `INSERT INTO networks (id, name, topic, tick_interval_seconds, max_ticks) VALUES ($1,$2,$3,$4,$5)`,
        [id, name, topic, tick_interval_seconds ?? env.DEFAULT_TICK_INTERVAL_SECONDS, max_ticks ?? 50],
      );
      return queryOne<Network>('SELECT * FROM networks WHERE id = $1', [id]);
    },
  );

  // Start network
  app.post<{ Params: { id: string } }>('/api/v1/networks/:id/start', async (req) => {
    const net = await queryOne<Network>('SELECT * FROM networks WHERE id = $1', [req.params.id]);
    if (!net) throw Errors.NOT_FOUND('Network');
    if (net.status === 'running')   throw Errors.CONFLICT('Network is already running');
    if (net.status === 'completed') throw Errors.CONFLICT('Network is already completed');

    const agents = await query<Agent>(
      'SELECT id FROM agents WHERE network_id = $1 AND is_active = true',
      [net.id],
    );
    if (agents.length === 0) throw Errors.CONFLICT('No active agents in network');

    await query(
      `UPDATE networks SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1`,
      [net.id],
    );
    await scheduleNetwork(net.id, agents.map(a => a.id), net.tick_interval_seconds, net.max_ticks, net.current_tick);
    await pubsub.publish(net.id, { type: 'network_started' });
    return queryOne<Network>('SELECT * FROM networks WHERE id = $1', [net.id]);
  });

  // Pause network
  app.post<{ Params: { id: string } }>('/api/v1/networks/:id/pause', async (req) => {
    const net = await queryOne<Network>('SELECT * FROM networks WHERE id = $1', [req.params.id]);
    if (!net) throw Errors.NOT_FOUND('Network');
    if (net.status !== 'running') throw Errors.SIMULATION_NOT_RUNNING();
    await cancelNetworkTicks(net.id);
    await query(`UPDATE networks SET status = 'paused' WHERE id = $1`, [net.id]);
    return queryOne<Network>('SELECT * FROM networks WHERE id = $1', [net.id]);
  });

  // Stop network
  app.post<{ Params: { id: string } }>('/api/v1/networks/:id/stop', async (req) => {
    const net = await queryOne<Network>('SELECT * FROM networks WHERE id = $1', [req.params.id]);
    if (!net) throw Errors.NOT_FOUND('Network');
    await cancelNetworkTicks(net.id);
    await query(`UPDATE networks SET status = 'completed', completed_at = now() WHERE id = $1`, [net.id]);
    return queryOne<Network>('SELECT * FROM networks WHERE id = $1', [net.id]);
  });

  // Stats
  app.get<{ Params: { id: string } }>('/api/v1/networks/:id/stats', async (req) => {
    const net = await queryOne<Network>('SELECT * FROM networks WHERE id = $1', [req.params.id]);
    if (!net) throw Errors.NOT_FOUND('Network');

    const [[postCount], [interactionCount], [agentCount], topAgents, actionBreakdown] = await Promise.all([
      query<{ count: string }>('SELECT COUNT(*) as count FROM posts WHERE network_id = $1', [net.id]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM interactions WHERE network_id = $1', [net.id]),
      query<{ count: string }>('SELECT COUNT(*) as count FROM agents WHERE network_id = $1', [net.id]),
      query<{ handle: string; post_count: number; follower_count: number }>(
        `SELECT handle, post_count, follower_count FROM agents WHERE network_id = $1 ORDER BY post_count DESC LIMIT 5`,
        [net.id],
      ),
      query<{ action: string; count: string }>(
        `SELECT action, COUNT(*) as count FROM agent_ticks WHERE network_id = $1 GROUP BY action ORDER BY count DESC`,
        [net.id],
      ),
    ]);

    return {
      network: net,
      post_count:        parseInt(postCount?.count ?? '0'),
      interaction_count: parseInt(interactionCount?.count ?? '0'),
      agent_count:       parseInt(agentCount?.count ?? '0'),
      total_tokens_used: net.total_tokens_used,
      total_cost_usd:    parseFloat(String(net.total_cost_usd)),
      top_agents:        topAgents,
      action_breakdown:  actionBreakdown.map(r => ({ action: r.action, count: parseInt(r.count) })),
    };
  });

  // SSE live stream
  app.get<{ Params: { id: string } }>('/api/v1/networks/:id/stream', async (req, reply) => {
    const netId = req.params.id;
    const net = await queryOne<Network>('SELECT id FROM networks WHERE id = $1', [netId]);
    if (!net) throw Errors.NOT_FOUND('Network');

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    if (openSseConnections.count >= MAX_SSE_CONNECTIONS) {
      throw Errors.CONFLICT('SSE connection limit reached. Try again later.');
    }

    openSseConnections.count++;
    const channel = pubsub.channel(netId);
    const sub = pubsub.subscriber;
    await sub.subscribe(channel);

    const onMessage = (ch: string, msg: string) => {
      if (ch === channel) reply.raw.write(`data: ${msg}\n\n`);
    };
    sub.on('message', onMessage);

    const heartbeat = setInterval(() => reply.raw.write(':heartbeat\n\n'), 15_000);

    req.raw.on('close', async () => {
      openSseConnections.count--;
      clearInterval(heartbeat);
      sub.off('message', onMessage);
      await sub.unsubscribe(channel);
    });
  });
}
