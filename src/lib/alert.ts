import { logger } from './logger.js';

/** Structured alert events. These log at ERROR/WARN level with an `alert` field for easy filtering. */
export const alert = {
  costSpike: (networkId: string, costUsd: number) =>
    logger.error({ alert: 'COST_SPIKE', networkId, costUsd }, 'Network hit cost cap'),

  dailyBudgetNear: (spentUsd: number, limitUsd: number) =>
    logger.warn({ alert: 'BUDGET_WARNING', spentUsd, limitUsd }, 'Daily budget 80% consumed'),

  dailyBudgetHit: (spentUsd: number) =>
    logger.error({ alert: 'BUDGET_HIT', spentUsd }, 'Daily Claude budget exhausted — all ticks halted'),

  registrationSpike: (count: number) =>
    logger.error({ alert: 'REGISTRATION_SPIKE', count }, 'Unusual API key registration volume'),

  sseOverload: (openConnections: number) =>
    logger.warn({ alert: 'SSE_OVERLOAD', openConnections }, 'High number of open SSE connections'),
};
