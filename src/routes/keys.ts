import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { generateApiKey } from '../lib/api-key.js';
import { requireAdminKey } from '../middleware/require-auth.js';
import { alert } from '../lib/alert.js';
import type { ApiKey } from '../types.js';

const VALID_TIERS = ['reader', 'writer'] as const;

export async function keysRoutes(app: FastifyInstance) {
  const adminAuth = { onRequest: [requireAdminKey()] };

  // Register a new key (admin only)
  app.post<{ Body: { label: string; tier?: string } }>(
    '/api/v1/keys/register',
    {
      ...adminAuth,
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['label'],
          additionalProperties: false,
          properties: {
            label: { type: 'string', minLength: 1, maxLength: 80 },
            tier:  { type: 'string', enum: ['reader', 'writer'] },
          },
        },
      },
    },
    async (req, reply) => {
      const tier = (req.body.tier ?? 'reader') as typeof VALID_TIERS[number];
      const { raw, hash, prefix } = generateApiKey();
      const id = newId.apiKey();

      await query(
        `INSERT INTO external_api_keys (id, key_hash, key_prefix, label, tier) VALUES ($1,$2,$3,$4,$5)`,
        [id, hash, prefix, req.body.label, tier],
      );

      // Check for registration spike
      const recentCount = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count FROM external_api_keys WHERE created_at > now() - interval '1 hour'`,
      );
      if (parseInt(recentCount?.count ?? '0') > 10) alert.registrationSpike(parseInt(recentCount!.count));

      return reply.status(201).send({
        id,
        api_key: raw,   // shown ONCE — store it now
        prefix,
        tier,
        label: req.body.label,
        warning: 'Store this key securely — it cannot be retrieved again.',
      });
    },
  );

  // List keys (admin only — never returns hashes)
  app.get('/api/v1/keys', adminAuth, async () => {
    return query<Omit<ApiKey, 'key_hash'>>(
      `SELECT id, key_prefix, label, tier, is_active, requests_today, last_used_at, created_at, revoked_at
       FROM external_api_keys ORDER BY created_at DESC`,
    );
  });

  // Revoke a key (admin only)
  app.delete<{ Params: { id: string } }>('/api/v1/keys/:id', adminAuth, async (req, reply) => {
    const key = await queryOne<ApiKey>('SELECT id FROM external_api_keys WHERE id = $1', [req.params.id]);
    if (!key) return reply.status(404).send({ error: 'NOT_FOUND' });
    await query(
      `UPDATE external_api_keys SET is_active = false, revoked_at = now() WHERE id = $1`,
      [req.params.id],
    );
    return reply.status(200).send({ revoked: true });
  });
}
