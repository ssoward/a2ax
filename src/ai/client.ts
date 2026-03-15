import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// Token cost in USD per 1M tokens
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00 },
};

export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING['claude-haiku-4-5-20251001'];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
