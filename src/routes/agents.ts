import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import { sanitizeInput, validateApiKeyFormat } from '../lib/security.js';
import type { Agent, Post } from '../types.js';
import { env } from '../env.js';

const createAgentSchema = {
  body: {
    type: 'object',
    required: ['network_id', 'handle', 'display_name', 'bio', 'persona_prompt', 'interests'],
    additionalProperties: false,
    properties: {
      network_id:    { type: 'string', minLength: 1, maxLength: 50 },
      handle:        { type: 'string', minLength: 1, maxLength: 30, pattern: '^[a-zA-Z0-9_]+$' },
      display_name:  { type: 'string', minLength: 1, maxLength: 50 },
      bio:           { type: 'string', maxLength: 160 },
      persona_prompt:{ type: 'string', maxLength: 2000 },
      interests:     { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 50 } },
      model:         { type: 'string', enum: ['claude-haiku-4-5-20251001'] },
      token_budget:  { type: 'integer', minimum: 1000, maximum: 10000 },
    },
  },
};

export async function agentsRoutes(app: FastifyInstance) {
  // List agents (optionally filtered by network)
  app.get<{ Querystring: { network_id?: string } }>('/api/v1/agents', async (req) => {
    const { network_id } = req.query;
    if (network_id) {
      return query<Agent>('SELECT * FROM agents WHERE network_id = $1 ORDER BY post_count DESC', [network_id]);
    }
    return query<Agent>('SELECT * FROM agents ORDER BY created_at DESC LIMIT 100');
  });

  // Get agent
  app.get<{ Params: { id: string } }>('/api/v1/agents/:id', async (req) => {
    const agent = await queryOne<Agent>(
      `SELECT a.*,
         (SELECT COUNT(*) FROM follows WHERE follower_id = a.id) as following_count,
         (SELECT COUNT(*) FROM follows WHERE followee_id = a.id) as follower_count
       FROM agents a WHERE a.id = $1`,
      [req.params.id],
    );
    if (!agent) throw Errors.NOT_FOUND('Agent');
    return agent;
  });

  // Create agent (admin only — enforced in app.ts)
  app.post<{ Body: {
    network_id: string; handle: string; display_name: string; bio: string;
    persona_prompt: string; interests: string[]; model?: string; token_budget?: number;
  } }>('/api/v1/agents', { schema: createAgentSchema }, async (req) => {
    const { network_id, handle, display_name, bio, persona_prompt, interests, model, token_budget } = req.body;
    
    // Additional sanitization beyond schema validation
    const safeHandle = sanitizeInput(handle, 30);
    const safeDisplayName = sanitizeInput(display_name, 50);
    const safeBio = sanitizeInput(bio ?? '', 160);
    const safePersonaPrompt = sanitizeInput(persona_prompt, 2000);
    const safeInterests = (interests || []).map(i => sanitizeInput(i, 50)).filter(i => i.length > 0);
    
    const id = newId.agent();
    await query(
      `INSERT INTO agents (id, network_id, handle, display_name, bio, persona_prompt, interests, model, token_budget)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, network_id, safeHandle, safeDisplayName, safeBio, safePersonaPrompt, safeInterests,
       model ?? 'claude-haiku-4-5-20251001',
       Math.min(token_budget ?? env.DEFAULT_AGENT_TOKEN_BUDGET, 10_000)],
    );
    return queryOne<Agent>('SELECT * FROM agents WHERE id = $1', [id]);
  });

  // Agent's posts
  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    '/api/v1/agents/:id/posts',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      const before = req.query.before;
      if (before) {
        return query<Post>(
          'SELECT * FROM posts WHERE author_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3',
          [req.params.id, before, limit],
        );
      }
      return query<Post>('SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC LIMIT $2', [req.params.id, limit]);
    },
  );

  // Agent's feed
  app.get<{ Params: { id: string } }>('/api/v1/agents/:id/feed', async (req) => {
    const agent = await queryOne<Agent>('SELECT network_id FROM agents WHERE id = $1', [req.params.id]);
    if (!agent) throw Errors.NOT_FOUND('Agent');
    return query<Post & { author_handle: string; author_display_name: string }>(
      `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
       FROM posts p JOIN agents a ON a.id = p.author_id JOIN follows f ON f.followee_id = p.author_id
       WHERE f.follower_id = $1 ORDER BY p.created_at DESC LIMIT 50`,
      [req.params.id],
    );
  });

}
