import { Queue, Worker, type Job } from 'bullmq';
import { runAgentTick } from '../ai/agent-brain.js';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { pubsub } from '../redis/client.js';
import { logger } from '../lib/logger.js';
import { alert } from '../lib/alert.js';
import { checkDailyBudget, recordCost } from '../lib/cost-guard.js';
import { env } from '../env.js';
import type { Agent, Post, Network } from '../types.js';

function getRedisConnection() {
  const url = new URL(env.REDIS_URL);
  const isTLS = url.protocol === 'rediss:';
  return {
    host: url.hostname,
    port: parseInt(url.port || (isTLS ? '6380' : '6379'), 10),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: isTLS ? {} : undefined,
  };
}

export const netQueue = new Queue('network-ticks', {
  connection: getRedisConnection(),
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
});

async function executeAgentTick(networkId: string, agentId: string, tickNumber: number): Promise<void> {
  const agent = await queryOne<Agent>('SELECT * FROM agents WHERE id = $1 AND is_active = true', [agentId]);
  if (!agent) return;

  const network = await queryOne<Network>('SELECT * FROM networks WHERE id = $1', [networkId]);
  if (!network || network.status !== 'running') return;

  // Per-agent token budget check
  if (agent.tokens_used >= agent.token_budget) {
    logger.warn({ agentId, handle: agent.handle }, 'Agent budget exhausted, skipping tick');
    return;
  }

  // Per-network cost cap
  const networkCost = parseFloat(String(network.total_cost_usd));
  if (networkCost >= env.NETWORK_COST_CAP_USD) {
    logger.warn({ networkId, networkCost }, 'Network hit cost cap, auto-completing');
    await query(`UPDATE networks SET status = 'completed', completed_at = now() WHERE id = $1`, [networkId]);
    await pubsub.publish(networkId, { type: 'network_completed_cost_cap', networkCost });
    alert.costSpike(networkId, networkCost);
    return;
  }

  // Daily global budget check
  if (!await checkDailyBudget()) {
    logger.warn({ networkId }, 'Daily budget exhausted, skipping all Claude calls');
    return;
  }

  // Build feed
  const feed = await query<Post & { author_handle: string; author_display_name: string }>(
    `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
     FROM posts p JOIN agents a ON a.id = p.author_id JOIN follows f ON f.followee_id = p.author_id
     WHERE f.follower_id = $1 AND p.network_id = $2 ORDER BY p.created_at DESC LIMIT 20`,
    [agentId, networkId],
  );

  // Supplement thin feed with trending posts
  if (feed.length < 5) {
    const trending = await query<Post & { author_handle: string; author_display_name: string }>(
      `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
       FROM posts p JOIN agents a ON a.id = p.author_id
       WHERE p.network_id = $1 AND p.author_id != $2
       ORDER BY (p.like_count + p.reply_count * 2 + p.repost_count) DESC, p.created_at DESC LIMIT 15`,
      [networkId, agentId],
    );
    const seen = new Set(feed.map(p => p.id));
    for (const p of trending) { if (!seen.has(p.id)) feed.push(p); }
  }

  const [recentPosts, availableAgents] = await Promise.all([
    query<Post>('SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT 5', [agentId]),
    query<Pick<Agent, 'id' | 'handle' | 'display_name' | 'bio'>>(
      `SELECT id, handle, display_name, bio FROM agents WHERE network_id = $1 AND id != $2 AND is_active = true LIMIT 20`,
      [networkId, agentId],
    ),
  ]);

  // Always use Haiku unless ALLOW_SONNET is explicitly enabled
  const effectiveAgent = env.ALLOW_SONNET ? agent : { ...agent, model: 'claude-haiku-4-5-20251001' as const };

  const { decision, tokensUsed, costUsd } = await runAgentTick(
    effectiveAgent, network.topic, feed, recentPosts, availableAgents,
  );

  await recordCost(costUsd);

  // Execute decision
  let postId: string | null = null;

  if (decision.action === 'post' && decision.content) {
    postId = newId.post();
    await query('INSERT INTO posts (id, network_id, author_id, content) VALUES ($1,$2,$3,$4)',
      [postId, networkId, agentId, decision.content]);
    await query('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [agentId]);
    const followers = await query<{ follower_id: string }>('SELECT follower_id FROM follows WHERE followee_id = $1', [agentId]);
    if (followers.length > 0) {
      const { feedCache } = await import('../redis/client.js');
      await feedCache.push(agentId, postId, followers.map(f => f.follower_id));
    }
    await pubsub.publish(networkId, {
      type: 'post',
      post: { id: postId, author_handle: agent.handle, author_display_name: agent.display_name, content: decision.content, created_at: new Date() },
    });

  } else if (decision.action === 'reply' && decision.content && decision.target_id) {
    postId = newId.post();
    await query('INSERT INTO posts (id, network_id, author_id, content, reply_to_id) VALUES ($1,$2,$3,$4,$5)',
      [postId, networkId, agentId, decision.content, decision.target_id]);
    await query('UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1', [decision.target_id]);
    await query('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [agentId]);
    await pubsub.publish(networkId, {
      type: 'reply',
      post: { id: postId, author_handle: agent.handle, content: decision.content, reply_to_id: decision.target_id },
    });

  } else if (decision.action === 'repost' && decision.target_id) {
    const reposted = await queryOne<Post>('SELECT * FROM posts WHERE id = $1', [decision.target_id]);
    if (reposted) {
      postId = newId.post();
      await query('INSERT INTO posts (id, network_id, author_id, content, repost_of_id) VALUES ($1,$2,$3,$4,$5)',
        [postId, networkId, agentId, decision.content ?? reposted.content, decision.target_id]);
      await query('UPDATE posts SET repost_count = repost_count + 1 WHERE id = $1', [decision.target_id]);
      await query('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [agentId]);
    }

  } else if (decision.action === 'like' && decision.target_id) {
    await query(
      `INSERT INTO interactions (id, network_id, type, actor_id, target_post_id) VALUES ($1,$2,'like',$3,$4) ON CONFLICT DO NOTHING`,
      [newId.interaction(), networkId, agentId, decision.target_id],
    );
    await query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [decision.target_id]);
    await query('UPDATE agents SET like_count = like_count + 1 WHERE id = $1', [agentId]);

  } else if (decision.action === 'follow' && decision.target_id) {
    await query('INSERT INTO follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [agentId, decision.target_id]);
    await query('UPDATE agents SET following_count = following_count + 1 WHERE id = $1', [agentId]);
    await query('UPDATE agents SET follower_count = follower_count + 1 WHERE id = $1', [decision.target_id]);
  }

  // Record tick + update budgets
  await query(
    `INSERT INTO agent_ticks (id, network_id, agent_id, tick_number, action, post_id, tokens_used, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [newId.tick(), networkId, agentId, tickNumber, decision.action, postId, tokensUsed, costUsd],
  );
  await query('UPDATE agents SET tokens_used = tokens_used + $1 WHERE id = $2', [tokensUsed, agentId]);
  await query(
    'UPDATE networks SET total_tokens_used = total_tokens_used + $1, total_cost_usd = total_cost_usd + $2 WHERE id = $3',
    [tokensUsed, costUsd, networkId],
  );
}

export function startWorker(): Worker {
  return new Worker('network-ticks', async (job: Job) => {
    const { networkId, agentIds, tickNumber } = job.data as {
      networkId: string; agentIds: string[]; tickNumber: number;
    };

    logger.info({ networkId, tickNumber, agentCount: agentIds.length }, 'Processing network tick');

    const CONCURRENCY = 5;
    for (let i = 0; i < agentIds.length; i += CONCURRENCY) {
      const batch = agentIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(agentId => executeAgentTick(networkId, agentId, tickNumber)),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error({ err: result.reason }, 'Agent tick failed');
        }
      }
    }

    await query('UPDATE networks SET current_tick = $1 WHERE id = $2', [tickNumber, networkId]);

    const net = await queryOne<Network>('SELECT max_ticks, status FROM networks WHERE id = $1', [networkId]);
    if (net && net.status === 'running' && tickNumber >= net.max_ticks) {
      await query(`UPDATE networks SET status = 'completed', completed_at = now() WHERE id = $1`, [networkId]);
      await pubsub.publish(networkId, { type: 'network_completed', tickNumber });
      logger.info({ networkId }, 'Network completed');
    }
  }, { connection: getRedisConnection(), concurrency: 1 });
}

export async function scheduleNetwork(
  networkId: string, agentIds: string[], tickIntervalSeconds: number,
  maxTicks: number, startingTick = 0,
): Promise<void> {
  const existing = await netQueue.getJobs(['delayed', 'waiting']);
  for (const job of existing) {
    if (job.data?.networkId === networkId) await job.remove();
  }
  for (let tick = startingTick + 1; tick <= maxTicks; tick++) {
    const delayMs = (tick - startingTick) * tickIntervalSeconds * 1000;
    await netQueue.add(
      `tick-${networkId}-${tick}`,
      { networkId, agentIds, tickNumber: tick },
      { delay: delayMs, jobId: `tick-${networkId}-${tick}` },
    );
  }
  logger.info({ networkId, maxTicks, tickIntervalSeconds }, 'Network ticks scheduled');
}

export async function cancelNetworkTicks(networkId: string): Promise<void> {
  const jobs = await netQueue.getJobs(['delayed', 'waiting']);
  let removed = 0;
  for (const job of jobs) {
    if (job.data?.networkId === networkId) { await job.remove(); removed++; }
  }
  logger.info({ networkId, removed }, 'Network ticks cancelled');
}
