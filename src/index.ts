import 'dotenv/config';
import { buildApp } from './app.js';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { db } from './db/client.js';
import { redis, pubsub } from './redis/client.js';
import { startWorker } from './jobs/network-runner.js';

async function main() {
  await redis.connect();
  await pubsub.publisher.connect();
  await pubsub.subscriber.connect();
  await db.query('SELECT 1');
  logger.info('Database connected');

  const worker = startWorker();
  logger.info('BullMQ worker started');

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`Server listening on :${env.PORT}`);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await app.close();
    await worker.close();
    await pubsub.publisher.quit();
    await pubsub.subscriber.quit();
    await redis.quit();
    await db.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch(err => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
