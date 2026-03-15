import Anthropic from '@anthropic-ai/sdk';
import { anthropic, computeCost } from './client.js';
import type { Agent, Post, AgentDecision } from '../types.js';
import { logger } from '../lib/logger.js';

interface FeedPost extends Post {
  author_handle: string;
  author_display_name: string;
}

interface BrainResult {
  decision: AgentDecision;
  tokensUsed: number;
  costUsd: number;
}

// Tool definition for structured agent decisions
const decisionTool: Anthropic.Tool = {
  name: 'make_decision',
  description: 'Record your social media action for this tick',
  input_schema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['post', 'reply', 'repost', 'like', 'follow', 'idle'],
        description: 'The action to take',
      },
      content: {
        type: 'string',
        description: 'Post content (max 280 chars). Required for post/reply, optional for repost (adds quote).',
      },
      target_id: {
        type: 'string',
        description: 'Post ID for reply/like/repost. Agent ID for follow.',
      },
      reasoning: {
        type: 'string',
        description: 'Brief internal reasoning (not shown publicly)',
      },
    },
    required: ['action'],
  },
};

function buildSystemPrompt(agent: Agent): string {
  return `You are ${agent.display_name} (@${agent.handle}) on a social network called X.
${agent.bio}

Your personality: ${agent.persona_prompt}
Your interests: ${agent.interests.join(', ')}

Behavioral guidelines:
- Post in your authentic voice — be opinionated, don't be generic
- Engage with content that aligns with OR challenges your worldview
- Keep posts under 280 characters
- Use hashtags naturally (1-2 max), not forced
- Reply to spark genuine conversation, not just agreement
- Don't like everything — be selective
- Follow agents whose content consistently interests you
- Idle sometimes — not every tick needs action`;
}

function formatFeed(feed: FeedPost[], recentPosts: Post[]): string {
  const lines: string[] = [];

  if (feed.length > 0) {
    lines.push('=== YOUR FEED (recent posts from people you follow) ===');
    for (const post of feed.slice(0, 15)) {
      lines.push(`[${post.id}] @${post.author_handle}: ${post.content} (👍${post.like_count} 🔁${post.repost_count} 💬${post.reply_count})`);
    }
  }

  if (recentPosts.length > 0) {
    lines.push('\n=== YOUR RECENT POSTS ===');
    for (const post of recentPosts.slice(0, 5)) {
      lines.push(`[${post.id}] ${post.content}`);
    }
  }

  return lines.join('\n') || 'Your feed is empty — consider posting something original.';
}

export async function runAgentTick(
  agent: Agent,
  scenario: string,
  feed: FeedPost[],
  recentPosts: Post[],
  availableAgents: Pick<Agent, 'id' | 'handle' | 'display_name' | 'bio'>[],
): Promise<BrainResult> {
  const feedText = formatFeed(feed, recentPosts);
  const agentList = availableAgents
    .filter(a => a.id !== agent.id)
    .map(a => `[${a.id}] @${a.handle} — ${a.bio}`)
    .join('\n');

  const userMessage = `Current simulation scenario: "${scenario}"

${feedText}

Other active users you could follow:
${agentList || 'None yet'}

Choose ONE action for this moment. Be authentic to your character.`;

  const response = await anthropic.messages.create({
    model: agent.model,
    max_tokens: 256,
    system: buildSystemPrompt(agent),
    messages: [{ role: 'user', content: userMessage }],
    tools: [decisionTool],
    tool_choice: { type: 'any' },
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    logger.warn({ agentId: agent.id }, 'Agent returned no tool use, defaulting to idle');
    return {
      decision: { action: 'idle' },
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      costUsd: computeCost(agent.model, response.usage.input_tokens, response.usage.output_tokens),
    };
  }

  const input = toolUse.input as AgentDecision & { reasoning?: string };
  const decision: AgentDecision = {
    action: input.action,
    content: input.content ? input.content.slice(0, 280) : undefined,
    target_id: input.target_id,
  };

  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
  const costUsd = computeCost(agent.model, response.usage.input_tokens, response.usage.output_tokens);

  logger.debug({
    agentId: agent.id,
    handle: agent.handle,
    action: decision.action,
    tokensUsed,
    costUsd: costUsd.toFixed(6),
    reasoning: input.reasoning,
  }, 'Agent tick complete');

  return { decision, tokensUsed, costUsd };
}
