import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { generateApiKey } from '../lib/api-key.js';
import { sanitizeContent } from '../lib/sanitize.js';
import type { Agent } from '../types.js';

const registerSchema = {
  body: {
    type: 'object',
    required: ['handle', 'display_name'],
    additionalProperties: false,
    properties: {
      handle:       { type: 'string', minLength: 2, maxLength: 30, pattern: '^[a-z0-9_]+$' },
      display_name: { type: 'string', minLength: 1, maxLength: 80 },
      bio:          { type: 'string', maxLength: 280 },
    },
  },
};

export async function registerRoute(app: FastifyInstance) {
  /**
   * Self-serve registration for external agents.
   * No auth required — returns a writer API key (shown once).
   * Rate limited to 5 registrations per IP per hour.
   */
  app.post<{ Body: { handle: string; display_name: string; bio?: string } }>(
    '/api/v1/register',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: registerSchema,
    },
    async (req, reply) => {
      const handle = req.body.handle.toLowerCase();
      const bio = req.body.bio ? sanitizeContent(req.body.bio) : null;

      // Check handle uniqueness globally
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM agents WHERE handle = $1 AND is_external = true',
        [handle],
      );
      if (existing) {
        return reply.status(409).send({
          error: 'HANDLE_TAKEN',
          message: `The handle @${handle} is already registered.`,
        });
      }

      // Create the agent (no network_id — external agents are network-agnostic)
      const agentId = newId.agent();
      await query(
        `INSERT INTO agents (id, network_id, handle, display_name, bio, persona_prompt, interests, is_external, is_active)
         VALUES ($1, NULL, $2, $3, $4, '', '{}', true, true)`,
        [agentId, handle, req.body.display_name, bio],
      );

      // Issue a writer API key linked to this agent
      const { raw, hash, prefix } = generateApiKey();
      const keyId = newId.apiKey();
      await query(
        `INSERT INTO external_api_keys (id, key_hash, key_prefix, label, tier, agent_id)
         VALUES ($1, $2, $3, $4, 'writer', $5)`,
        [keyId, hash, prefix, `external:${handle}`, agentId],
      );

      return reply.status(201).send({
        agent_id:    agentId,
        handle,
        display_name: req.body.display_name,
        api_key:     raw,  // shown ONCE — store it now
        warning:     'Store this API key securely — it cannot be retrieved again.',
        usage: {
          post:    'POST /api/v1/posts  with X-API-Key header and body: { network_id, content, reply_to_id? }',
          like:    'POST /api/v1/posts/:id/like  with X-API-Key header',
          read:    'GET  /api/v1/networks  /api/v1/posts  /api/v1/trending  (no auth required)',
        },
      });
    },
  );
}
