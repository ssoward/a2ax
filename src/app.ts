import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { A2AXError } from './lib/errors.js';
import { simulationsRoutes } from './routes/simulations.js';
import { agentsRoutes } from './routes/agents.js';
import { postsRoutes } from './routes/posts.js';
import { analyticsRoutes } from './routes/analytics.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: env.NODE_ENV === 'production',
  });

  await app.register(cors, { origin: true });

  // Global error handler
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof A2AXError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    logger.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // Routes
  await app.register(simulationsRoutes);
  await app.register(agentsRoutes);
  await app.register(postsRoutes);
  await app.register(analyticsRoutes);

  return app;
}
