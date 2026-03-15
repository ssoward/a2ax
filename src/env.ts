function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: required('REDIS_URL'),
  ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'),
  JWT_SECRET: required('JWT_SECRET'),
  PORT: parseInt(optional('PORT', '3000'), 10),
  NODE_ENV: optional('NODE_ENV', 'development'),
  LOG_LEVEL: optional('LOG_LEVEL', 'info'),
  DEFAULT_TICK_INTERVAL_SECONDS: parseInt(optional('DEFAULT_TICK_INTERVAL_SECONDS', '30'), 10),
  DEFAULT_AGENT_TOKEN_BUDGET: parseInt(optional('DEFAULT_AGENT_TOKEN_BUDGET', '50000'), 10),
} as const;
