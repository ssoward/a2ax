import { Queue, Worker, type Job } from 'bullmq';
import { runAgentTick } from '../ai/agent-brain.js';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { pubsub } from '../redis/client.js';
import { logger } from '../lib/logger.js';
import { env } from '../env.js';
import type { Agent, Post, Simulation } from '../types.js';

// BullMQ requires its own ioredis instance — use URL string via connection options
function getRedisConnection() {
  const url = new URL(env.REDIS_URL);
  return { host: url.hostname, port: parseInt(url.port || '6379', 10) };
}

// --- Queue definitions ---
export const simQueue = new Queue('simulation-ticks', {
  connection: getRedisConnection(),
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
});

// --- Execute a single agent's tick ---
async function executeAgentTick(
  simulationId: string,
  agentId: string,
  tickNumber: number,
): Promise<void> {
  const agent = await queryOne<Agent>(
    'SELECT * FROM agents WHERE id = $1 AND is_active = true',
    [agentId],
  );
  if (!agent) return;

  const simulation = await queryOne<Simulation>(
    'SELECT * FROM simulations WHERE id = $1',
    [simulationId],
  );
  if (!simulation || simulation.status !== 'running') return;

  // Budget check
  if (agent.tokens_used >= agent.token_budget) {
    logger.warn({ agentId, handle: agent.handle }, 'Agent budget exhausted, skipping tick');
    return;
  }

  // Build feed: posts from followed agents
  const feed = await query<Post & { author_handle: string; author_display_name: string }>(
    `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
     FROM posts p
     JOIN agents a ON a.id = p.author_id
     JOIN follows f ON f.followee_id = p.author_id
     WHERE f.follower_id = $1 AND p.simulation_id = $2
     ORDER BY p.created_at DESC
     LIMIT 20`,
    [agentId, simulationId],
  );

  // If feed is thin, supplement with trending posts
  if (feed.length < 5) {
    const trending = await query<Post & { author_handle: string; author_display_name: string }>(
      `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
       FROM posts p
       JOIN agents a ON a.id = p.author_id
       WHERE p.simulation_id = $1 AND p.author_id != $2
       ORDER BY (p.like_count + p.reply_count * 2 + p.repost_count * 1.5) DESC, p.created_at DESC
       LIMIT 15`,
      [simulationId, agentId],
    );
    const feedIds = new Set(feed.map(p => p.id));
    for (const p of trending) {
      if (!feedIds.has(p.id)) feed.push(p);
    }
  }

  const recentPosts = await query<Post>(
    'SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT 5',
    [agentId],
  );

  const availableAgents = await query<Pick<Agent, 'id' | 'handle' | 'display_name' | 'bio'>>(
    `SELECT id, handle, display_name, bio FROM agents
     WHERE simulation_id = $1 AND id != $2 AND is_active = true LIMIT 20`,
    [simulationId, agentId],
  );

  const { decision, tokensUsed, costUsd } = await runAgentTick(
    agent,
    simulation.scenario,
    feed,
    recentPosts,
    availableAgents,
  );

  // Execute the decision
  let postId: string | null = null;

  if (decision.action === 'post' && decision.content) {
    postId = newId.post();
    await query(
      'INSERT INTO posts (id, simulation_id, author_id, content) VALUES ($1,$2,$3,$4)',
      [postId, simulationId, agentId, decision.content],
    );
    await query('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [agentId]);

    // Fan-out to follower feeds
    const followers = await query<{ follower_id: string }>(
      'SELECT follower_id FROM follows WHERE followee_id = $1',
      [agentId],
    );
    const followerIds = followers.map(f => f.follower_id);
    if (followerIds.length > 0) {
      const { feedCache } = await import('../redis/client.js');
      await feedCache.push(agentId, postId, followerIds);
    }

    await pubsub.publish(simulationId, {
      type: 'post',
      post: { id: postId, author_handle: agent.handle, author_display_name: agent.display_name, content: decision.content, created_at: new Date() },
    });

  } else if (decision.action === 'reply' && decision.content && decision.target_id) {
    postId = newId.post();
    await query(
      'INSERT INTO posts (id, simulation_id, author_id, content, reply_to_id) VALUES ($1,$2,$3,$4,$5)',
      [postId, simulationId, agentId, decision.content, decision.target_id],
    );
    await query('UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1', [decision.target_id]);
    await query('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [agentId]);

    await pubsub.publish(simulationId, {
      type: 'reply',
      post: { id: postId, author_handle: agent.handle, content: decision.content, reply_to_id: decision.target_id },
    });

  } else if (decision.action === 'repost' && decision.target_id) {
    postId = newId.post();
    const reposted = await queryOne<Post>('SELECT * FROM posts WHERE id = $1', [decision.target_id]);
    if (reposted) {
      await query(
        'INSERT INTO posts (id, simulation_id, author_id, content, repost_of_id) VALUES ($1,$2,$3,$4,$5)',
        [postId, simulationId, agentId, decision.content ?? reposted.content, decision.target_id],
      );
      await query('UPDATE posts SET repost_count = repost_count + 1 WHERE id = $1', [decision.target_id]);
      await query('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [agentId]);
    }

  } else if (decision.action === 'like' && decision.target_id) {
    const interactionId = newId.interaction();
    await query(
      `INSERT INTO interactions (id, simulation_id, type, actor_id, target_post_id)
       VALUES ($1,$2,'like',$3,$4) ON CONFLICT DO NOTHING`,
      [interactionId, simulationId, agentId, decision.target_id],
    );
    await query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [decision.target_id]);
    await query('UPDATE agents SET like_count = like_count + 1 WHERE id = $1', [agentId]);

  } else if (decision.action === 'follow' && decision.target_id) {
    await query(
      'INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [agentId, decision.target_id],
    );
    await query('UPDATE agents SET following_count = following_count + 1 WHERE id = $1', [agentId]);
    await query('UPDATE agents SET follower_count = follower_count + 1 WHERE id = $1', [decision.target_id]);
  }

  // Record tick + update budgets
  const tickId = newId.tick();
  await query(
    `INSERT INTO agent_ticks (id, simulation_id, agent_id, tick_number, action, post_id, tokens_used, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tickId, simulationId, agentId, tickNumber, decision.action, postId, tokensUsed, costUsd],
  );
  await query(
    'UPDATE agents SET tokens_used = tokens_used + $1 WHERE id = $2',
    [tokensUsed, agentId],
  );
  await query(
    'UPDATE simulations SET total_tokens_used = total_tokens_used + $1, total_cost_usd = total_cost_usd + $2 WHERE id = $3',
    [tokensUsed, costUsd, simulationId],
  );
}

// --- Worker: processes one simulation tick (all agents) ---
export function startWorker(): Worker {
  return new Worker(
    'simulation-ticks',
    async (job: Job) => {
      const { simulationId, agentIds, tickNumber } = job.data as {
        simulationId: string;
        agentIds: string[];
        tickNumber: number;
      };

      logger.info({ simulationId, tickNumber, agentCount: agentIds.length }, 'Processing simulation tick');

      // Run all agents concurrently (with concurrency cap)
      const CONCURRENCY = 5;
      for (let i = 0; i < agentIds.length; i += CONCURRENCY) {
        const batch = agentIds.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(agentId => executeAgentTick(simulationId, agentId, tickNumber)),
        );
        for (const result of results) {
          if (result.status === 'rejected') {
            logger.error({ err: result.reason }, 'Agent tick failed');
          }
        }
      }

      // Advance tick counter
      await query(
        'UPDATE simulations SET current_tick = $1 WHERE id = $2',
        [tickNumber, simulationId],
      );

      // Check if simulation should complete
      const sim = await queryOne<Simulation>(
        'SELECT max_ticks, status FROM simulations WHERE id = $1',
        [simulationId],
      );
      if (sim && sim.status === 'running' && tickNumber >= sim.max_ticks) {
        await query(
          `UPDATE simulations SET status = 'completed', completed_at = now() WHERE id = $1`,
          [simulationId],
        );
        await pubsub.publish(simulationId, { type: 'simulation_completed', tickNumber });
        logger.info({ simulationId }, 'Simulation completed');
      }
    },
    { connection: getRedisConnection(), concurrency: 1 },
  );
}

// --- Schedule recurring ticks for a simulation ---
export async function scheduleSimulation(
  simulationId: string,
  agentIds: string[],
  tickIntervalSeconds: number,
  maxTicks: number,
  startingTick = 0,
): Promise<void> {
  // Remove existing jobs for this simulation
  const existingJobs = await simQueue.getJobs(['delayed', 'waiting']);
  for (const job of existingJobs) {
    if (job.data?.simulationId === simulationId) {
      await job.remove();
    }
  }

  // Schedule all ticks
  for (let tick = startingTick + 1; tick <= maxTicks; tick++) {
    const delayMs = (tick - startingTick) * tickIntervalSeconds * 1000;
    await simQueue.add(
      `tick-${simulationId}-${tick}`,
      { simulationId, agentIds, tickNumber: tick },
      { delay: delayMs, jobId: `tick-${simulationId}-${tick}` },
    );
  }

  logger.info({ simulationId, maxTicks, tickIntervalSeconds }, 'Simulation ticks scheduled');
}

// --- Remove all scheduled ticks for a simulation ---
export async function cancelSimulationTicks(simulationId: string): Promise<void> {
  const jobs = await simQueue.getJobs(['delayed', 'waiting']);
  let removed = 0;
  for (const job of jobs) {
    if (job.data?.simulationId === simulationId) {
      await job.remove();
      removed++;
    }
  }
  logger.info({ simulationId, removed }, 'Simulation ticks cancelled');
}
