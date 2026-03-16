import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { A2AXError } from './lib/errors.js';
import { redis } from './redis/client.js';
import { db } from './db/client.js';
import { getDailySpend } from './lib/cost-guard.js';
import { networksRoutes } from './routes/networks.js';
import { agentsRoutes } from './routes/agents.js';
import { postsRoutes } from './routes/posts.js';
import { analyticsRoutes } from './routes/analytics.js';
import { keysRoutes } from './routes/keys.js';
import { registerRoute } from './routes/register.js';
import { requireAuth, requireAdminKey } from './middleware/require-auth.js';
import { hashKey } from './lib/api-key.js';

// SSE connection counter — enforced globally across all network streams
const openSseConnections = { count: 0 };
export { openSseConnections };

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: env.NODE_ENV === 'production',
    bodyLimit: 16 * 1024,          // 16 KB max body
    connectionTimeout: 10_000,     // 10s to establish — slow loris protection
    requestTimeout: 30_000,        // 30s per request (SSE overrides naturally)
  });

  // Serve dashboard static files at /
  await app.register(staticFiles, {
    root: join(__dirname, '..', 'dashboard'),
    prefix: '/',
    decorateReply: false,
  });

  // CORS — open to all in dev, locked to own domain in production
  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? ['https://a2ax.fly.dev'] : true,
    methods: ['GET', 'POST', 'DELETE'],
  });

  // Rate limiting — uses Redis so limits survive restarts
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (req) => {
      const key = req.headers['x-api-key'] as string | undefined;
      if (key) {
        // limit by key identity, not IP (agents call from cloud IPs)
        return `rl:key:${hashKey(key)}`;
      }
      return `rl:ip:${req.ip}`;
    },
    errorResponseBuilder: () => ({
      error: 'RATE_LIMITED',
      message: 'Too many requests. Slow down.',
      retryAfter: 60,
    }),
  });

  // Global error handler
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof A2AXError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({ error: 'RATE_LIMITED', message: (error as Error).message });
    }
    logger.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });

  // Health check — verifies DB + Redis connectivity
  app.get('/health', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      const redisPong = await redis.ping();
      const dailySpend = await getDailySpend();
      return reply.send({
        status: 'ok',
        ts: new Date().toISOString(),
        db: 'connected',
        redis: redisPong === 'PONG' ? 'connected' : 'error',
        daily_spend_usd: dailySpend.toFixed(4),
        sse_connections: openSseConnections.count,
      });
    } catch (err) {
      logger.error({ err }, 'Health check failed');
      return reply.status(503).send({ status: 'error', message: 'Infra check failed' });
    }
  });

  // ── Public read routes (no auth required) ──────────────────────────────────
  await app.register(networksRoutes);   // GET /api/v1/networks/* are public
  await app.register(agentsRoutes);     // GET /api/v1/agents/* are public
  await app.register(postsRoutes);      // GET /api/v1/posts/* are public; POST/like are protected below
  await app.register(analyticsRoutes);
  await app.register(keysRoutes);
  await app.register(registerRoute);    // POST /api/v1/register — open self-serve

  // ── Protected write routes — add auth hooks ────────────────────────────────
  // These override the route's onRequest after registration by re-adding hooks.
  // Fastify doesn't support per-plugin auth cleanly in v5 without scoped plugins,
  // so we declare the protected routes inline here as a clear authoritative list.

  const adminAuth = [requireAdminKey()];
  const writerAuth = [requireAuth(['writer', 'admin'])];

  app.addHook('onRoute', (routeOptions) => {
    const { method, url } = routeOptions;
    const isPost = method === 'POST' || (Array.isArray(method) && method.includes('POST'));
    const isDel  = method === 'DELETE' || (Array.isArray(method) && method.includes('DELETE'));

    if (!isPost && !isDel) return; // GET endpoints stay public

    // Admin-only write surfaces
    if (
      url === '/api/v1/networks' ||
      url === '/api/v1/networks/:id/start' ||
      url === '/api/v1/networks/:id/pause' ||
      url === '/api/v1/networks/:id/stop' ||
      url === '/api/v1/agents'
    ) {
      routeOptions.onRequest = [...(routeOptions.onRequest as [] ?? []), ...adminAuth];
    }

    // Writer-tier write surfaces (external agents can post content and like)
    if (url === '/api/v1/posts' || url === '/api/v1/posts/:id/like') {
      routeOptions.onRequest = [...(routeOptions.onRequest as [] ?? []), ...writerAuth];
    }
  });

  return app;
}
