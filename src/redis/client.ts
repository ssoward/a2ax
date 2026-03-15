import { Redis } from 'ioredis';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (err: Error) => logger.error({ err }, 'Redis error'));
redis.on('connect', () => logger.info('Redis connected'));

// Feed cache helpers
export const feedCache = {
  key: (agentId: string) => `feed:${agentId}`,

  async get(agentId: string): Promise<string[]> {
    const raw = await redis.lrange(feedCache.key(agentId), 0, 49);
    return raw;
  },

  async push(followeeId: string, postId: string, followerIds: string[]): Promise<void> {
    if (followerIds.length === 0) return;
    const pipeline = redis.pipeline();
    for (const followerId of followerIds) {
      const key = feedCache.key(followerId);
      pipeline.lpush(key, postId);
      pipeline.ltrim(key, 0, 99); // keep last 100 posts per feed
      pipeline.expire(key, 3600 * 24); // 24hr TTL
    }
    await pipeline.exec();
  },
};

// SSE event bus (pub/sub for real-time dashboard)
export const pubsub = {
  publisher: new Redis(env.REDIS_URL, { lazyConnect: true }),
  subscriber: new Redis(env.REDIS_URL, { lazyConnect: true }),

  channel: (simulationId: string) => `sim:${simulationId}:events`,

  async publish(simulationId: string, event: object): Promise<void> {
    await pubsub.publisher.publish(
      pubsub.channel(simulationId),
      JSON.stringify(event),
    );
  },
};
