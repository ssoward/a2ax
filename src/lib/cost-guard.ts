import { redis } from '../redis/client.js';
import { env } from '../env.js';
import { logger } from './logger.js';
import { alert } from './alert.js';

function dailyKey(): string {
  return `cost:daily:${new Date().toISOString().slice(0, 10)}`;
}

/** Record Claude API cost. Call after every successful tick. */
export async function recordCost(usd: number): Promise<void> {
  const key = dailyKey();
  const newTotal = parseFloat(await redis.incrbyfloat(key, usd));
  await redis.expire(key, 86400 * 2); // 2-day TTL

  // Warn at 80% of daily limit
  if (newTotal >= env.MAX_DAILY_COST_USD * 0.8 && newTotal - usd < env.MAX_DAILY_COST_USD * 0.8) {
    alert.dailyBudgetNear(newTotal, env.MAX_DAILY_COST_USD);
  }
}

/** Returns true if there is remaining daily budget. False = halt Claude calls. */
export async function checkDailyBudget(): Promise<boolean> {
  const spent = parseFloat((await redis.get(dailyKey())) ?? '0');
  if (spent >= env.MAX_DAILY_COST_USD) {
    logger.warn({ spent, limit: env.MAX_DAILY_COST_USD }, 'Daily Claude budget exhausted');
    return false;
  }
  return true;
}

/** Get current daily spend in USD. */
export async function getDailySpend(): Promise<number> {
  return parseFloat((await redis.get(dailyKey())) ?? '0');
}
