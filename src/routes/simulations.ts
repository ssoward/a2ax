import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import { scheduleSimulation, cancelSimulationTicks } from '../jobs/simulation-runner.js';
import { pubsub, redis } from '../redis/client.js';
import type { Simulation, Agent } from '../types.js';
import { env } from '../env.js';

export async function simulationsRoutes(app: FastifyInstance) {
  // List simulations
  app.get('/api/v1/simulations', async () => {
    return query<Simulation>('SELECT * FROM simulations ORDER BY created_at DESC');
  });

  // Get simulation
  app.get<{ Params: { id: string } }>('/api/v1/simulations/:id', async (req) => {
    const sim = await queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [req.params.id]);
    if (!sim) throw Errors.NOT_FOUND('Simulation');
    return sim;
  });

  // Create simulation
  app.post<{
    Body: {
      name: string;
      scenario: string;
      tick_interval_seconds?: number;
      max_ticks?: number;
    };
  }>('/api/v1/simulations', async (req) => {
    const { name, scenario, tick_interval_seconds, max_ticks } = req.body;
    const id = newId.simulation();
    await query(
      `INSERT INTO simulations (id, name, scenario, tick_interval_seconds, max_ticks)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, name, scenario, tick_interval_seconds ?? env.DEFAULT_TICK_INTERVAL_SECONDS, max_ticks ?? 50],
    );
    return queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [id]);
  });

  // Start simulation
  app.post<{ Params: { id: string } }>('/api/v1/simulations/:id/start', async (req) => {
    const sim = await queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [req.params.id]);
    if (!sim) throw Errors.NOT_FOUND('Simulation');
    if (sim.status === 'running') throw Errors.CONFLICT('Simulation is already running');
    if (sim.status === 'completed') throw Errors.CONFLICT('Simulation is already completed');

    const agents = await query<Agent>(
      'SELECT id FROM agents WHERE simulation_id = $1 AND is_active = true',
      [sim.id],
    );
    if (agents.length === 0) throw Errors.CONFLICT('No active agents in simulation');

    await query(
      `UPDATE simulations SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1`,
      [sim.id],
    );

    await scheduleSimulation(
      sim.id,
      agents.map(a => a.id),
      sim.tick_interval_seconds,
      sim.max_ticks,
      sim.current_tick,
    );

    await pubsub.publish(sim.id, { type: 'simulation_started' });
    return queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [sim.id]);
  });

  // Pause simulation
  app.post<{ Params: { id: string } }>('/api/v1/simulations/:id/pause', async (req) => {
    const sim = await queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [req.params.id]);
    if (!sim) throw Errors.NOT_FOUND('Simulation');
    if (sim.status !== 'running') throw Errors.SIMULATION_NOT_RUNNING();

    await cancelSimulationTicks(sim.id);
    await query(`UPDATE simulations SET status = 'paused' WHERE id = $1`, [sim.id]);
    return queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [sim.id]);
  });

  // Stop simulation
  app.post<{ Params: { id: string } }>('/api/v1/simulations/:id/stop', async (req) => {
    const sim = await queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [req.params.id]);
    if (!sim) throw Errors.NOT_FOUND('Simulation');

    await cancelSimulationTicks(sim.id);
    await query(
      `UPDATE simulations SET status = 'completed', completed_at = now() WHERE id = $1`,
      [sim.id],
    );
    return queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [sim.id]);
  });

  // Stats
  app.get<{ Params: { id: string } }>('/api/v1/simulations/:id/stats', async (req) => {
    const sim = await queryOne<Simulation>('SELECT * FROM simulations WHERE id = $1', [req.params.id]);
    if (!sim) throw Errors.NOT_FOUND('Simulation');

    const [postCount] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM posts WHERE simulation_id = $1',
      [sim.id],
    );
    const [interactionCount] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM interactions WHERE simulation_id = $1',
      [sim.id],
    );
    const [agentCount] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM agents WHERE simulation_id = $1',
      [sim.id],
    );
    const topAgents = await query<{ handle: string; post_count: number; follower_count: number }>(
      `SELECT handle, post_count, follower_count FROM agents
       WHERE simulation_id = $1 ORDER BY post_count DESC LIMIT 5`,
      [sim.id],
    );
    const tickBreakdown = await query<{ action: string; count: string }>(
      `SELECT action, COUNT(*) as count FROM agent_ticks
       WHERE simulation_id = $1 GROUP BY action ORDER BY count DESC`,
      [sim.id],
    );

    return {
      simulation: sim,
      post_count: parseInt(postCount?.count ?? '0'),
      interaction_count: parseInt(interactionCount?.count ?? '0'),
      agent_count: parseInt(agentCount?.count ?? '0'),
      total_tokens_used: sim.total_tokens_used,
      total_cost_usd: parseFloat(String(sim.total_cost_usd)),
      top_agents: topAgents,
      action_breakdown: tickBreakdown.map(r => ({ action: r.action, count: parseInt(r.count) })),
    };
  });

  // SSE stream — real-time events
  app.get<{ Params: { id: string } }>('/api/v1/simulations/:id/stream', async (req, reply) => {
    const simId = req.params.id;
    const sim = await queryOne<Simulation>('SELECT id FROM simulations WHERE id = $1', [simId]);
    if (!sim) throw Errors.NOT_FOUND('Simulation');

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const channel = pubsub.channel(simId);
    const sub = pubsub.subscriber;

    await sub.subscribe(channel);
    const onMessage = (ch: string, msg: string) => {
      if (ch === channel) {
        reply.raw.write(`data: ${msg}\n\n`);
      }
    };
    sub.on('message', onMessage);

    // Heartbeat
    const heartbeat = setInterval(() => {
      reply.raw.write(':heartbeat\n\n');
    }, 15_000);

    req.raw.on('close', async () => {
      clearInterval(heartbeat);
      sub.off('message', onMessage);
      await sub.unsubscribe(channel);
    });
  });
}
