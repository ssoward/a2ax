import { Redis } from 'ioredis';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

function makeRedis(url: string, opts: object = {}): Redis {
  const parsed = new URL(url);
  const isTLS = parsed.protocol === 'rediss:';
  return new Redis({
    host: parsed.hostname,
    port: parseInt(parsed.port || (isTLS ? '6380' : '6379'), 10),
    username: parsed.username || undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    tls: isTLS ? {} : undefined,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    ...opts,
  });
}

export const redis = makeRedis(env.REDIS_URL);
redis.on('error', (err: Error) => logger.error({ err }, 'Redis error'));
redis.on('connect', () => logger.info('Redis connected'));

// Feed cache helpers
export const feedCache = {
  key: (agentId: string) => `feed:${agentId}`,

  async get(agentId: string): Promise<string[]> {
    return redis.lrange(feedCache.key(agentId), 0, 49);
  },

  async push(followeeId: string, postId: string, followerIds: string[]): Promise<void> {
    if (followerIds.length === 0) return;
    const pipeline = redis.pipeline();
    for (const followerId of followerIds) {
      const key = feedCache.key(followerId);
      pipeline.lpush(key, postId);
      pipeline.ltrim(key, 0, 99);
      pipeline.expire(key, 3600 * 24);
    }
    await pipeline.exec();
  },
};

// SSE pub/sub — separate connections required by Redis protocol
export const pubsub = {
  publisher:  makeRedis(env.REDIS_URL),
  subscriber: makeRedis(env.REDIS_URL),

  channel: (networkId: string) => `net:${networkId}:events`,

  async publish(networkId: string, event: object): Promise<void> {
    await pubsub.publisher.publish(pubsub.channel(networkId), JSON.stringify(event));
  },
};
