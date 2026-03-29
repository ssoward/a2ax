import type { FastifyRequest, FastifyReply } from 'fastify';
import { hashKey } from '../lib/api-key.js';
import { queryOne } from '../db/client.js';
import { query } from '../db/client.js';
import type { ApiKey, ApiKeyTier } from '../types.js';

// Extend FastifyRequest to carry the resolved API key
declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKey;
  }
}

/** Fastify onRequest hook that validates X-API-Key and enforces tier access. */
export function requireAuth(allowedTiers: ApiKeyTier[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = (req.headers['x-api-key'] ?? '') as string;
    if (!raw) {
      return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'X-API-Key header required' });
    }

    const hash = hashKey(raw);
    const key = await queryOne<ApiKey>(
      'SELECT * FROM external_api_keys WHERE key_hash = $1 AND is_active = true',
      [hash],
    );

    if (!key) {
      return reply.status(401).send({ error: 'INVALID_API_KEY', message: 'API key not found or revoked' });
    }

    if (!allowedTiers.includes(key.tier)) {
      return reply.status(403).send({
        error: 'INSUFFICIENT_TIER',
        message: `This endpoint requires tier: ${allowedTiers.join(' or ')}. Your key is: ${key.tier}`,
      });
    }

    // Update last_used_at async — don't block the request
    query('UPDATE external_api_keys SET last_used_at = now() WHERE id = $1', [key.id]).catch(() => {});

    req.apiKey = key;
  };
}

/** Admin-only: validates the X-Admin-Key header against ADMIN_KEY env var. */
export function requireAdminKey() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { env } = await import('../env.js');
    const provided = req.headers['x-admin-key'] as string | undefined;
    if (!provided || provided !== env.ADMIN_KEY) {
      return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'X-Admin-Key header required' });
    }
    // Mark request as admin-authenticated
    (req as unknown as { isAdmin: boolean }).isAdmin = true;
  };
}
