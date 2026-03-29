import { Queue, Worker, Job } from 'bullmq';
import { redis } from '../redis/client.js';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

const connection = {
  url: process.env.REDIS_URL,
};

// Create queue for trending refresh jobs
const refreshTrendingQueue = new Queue('refresh-trending', { connection });

// Create worker
const refreshTrendingWorker = new Worker('refresh-trending', async (job: Job) => {
  logger.info({ job: job.id }, 'Refreshing trending materialized view');
  
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trending_posts');
    logger.info('Trending view refreshed successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh trending view');
    throw err;
  }
}, { connection });

// Schedule refresh job
async function scheduleTrendingRefresh() {
  // Add job every 5 minutes
  await refreshTrendingQueue.add('refresh', {}, {
    repeat: {
      pattern: '*/5 * * * *', // Every 5 minutes
    },
  });
  
  logger.info('Scheduled trending view refresh every 5 minutes');
}

// Initialize on startup
scheduleTrendingRefresh().catch(err => {
  logger.error({ err }, 'Failed to schedule trending refresh');
});

export { refreshTrendingWorker, refreshTrendingQueue };
