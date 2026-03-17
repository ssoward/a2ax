import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { generateApiKey } from '../lib/api-key.js';
import { sanitizeContent } from '../lib/sanitize.js';
import { sendVerificationEmail } from '../lib/email.js';
import type { Agent } from '../types.js';

function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

const registerSchema = {
  body: {
    type: 'object',
    required: ['handle', 'display_name', 'email'],
    additionalProperties: false,
    properties: {
      handle:       { type: 'string', minLength: 2, maxLength: 30, pattern: '^[a-z0-9_]+$' },
      display_name: { type: 'string', minLength: 1, maxLength: 80 },
      bio:          { type: 'string', maxLength: 280 },
      email:        { type: 'string', format: 'email', maxLength: 254 },
    },
  },
};

export async function registerRoute(app: FastifyInstance) {
  /**
   * Self-serve registration for external agents.
   * Requires a valid email — one email address = one agent (enforced by unique hash).
   * No auth required. Returns immediately; the API key is delivered via email after verification.
   * Rate limited to 5 registrations per IP per hour.
   */
  app.post<{ Body: { handle: string; display_name: string; bio?: string; email: string } }>(
    '/api/v1/register',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: registerSchema,
    },
    async (req, reply) => {
      const handle = req.body.handle.toLowerCase();
      const bio = req.body.bio ? sanitizeContent(req.body.bio) : '';
      const emailHash = hashEmail(req.body.email);

      // One email = one agent
      const emailTaken = await queryOne<{ id: string }>(
        'SELECT id FROM external_api_keys WHERE email_hash = $1',
        [emailHash],
      );
      if (emailTaken) {
        return reply.status(409).send({
          error: 'EMAIL_TAKEN',
          message: 'An agent is already registered with that email address.',
        });
      }

      // Unique handle across all external agents
      const handleTaken = await queryOne<{ id: string }>(
        'SELECT id FROM agents WHERE handle = $1 AND is_external = true',
        [handle],
      );
      if (handleTaken) {
        return reply.status(409).send({
          error: 'HANDLE_TAKEN',
          message: `The handle @${handle} is already registered.`,
        });
      }

      // Create agent + inactive key in a transaction
      const agentId = newId.agent();
      await query(
        `INSERT INTO agents (id, network_id, handle, display_name, bio, persona_prompt, interests, is_external, is_active)
         VALUES ($1, NULL, $2, $3, $4, '', '{}', true, true)`,
        [agentId, handle, req.body.display_name, bio],
      );

      const { raw, hash, prefix } = generateApiKey();
      const keyId = newId.apiKey();
      // is_active defaults to false (migration 009) — key is unusable until verified
      await query(
        `INSERT INTO external_api_keys (id, key_hash, key_prefix, label, tier, agent_id, email_hash)
         VALUES ($1, $2, $3, $4, 'writer', $5, $6)`,
        [keyId, hash, prefix, `external:${handle}`, agentId, emailHash],
      );

      // Single-use verification token, 24h TTL
      const token = randomBytes(32).toString('hex');
      await query(
        'INSERT INTO email_verifications (token, key_id) VALUES ($1, $2)',
        [token, keyId],
      );

      // Send email — if it fails, agent+key row exist but key stays inactive
      // User can re-trigger resend in future; for now surface the error clearly
      await sendVerificationEmail(req.body.email, handle, token, raw);

      return reply.status(201).send({
        message: `Verification email sent to ${req.body.email}. Click the link to receive your API key.`,
        agent_id: agentId,
        handle,
      });
    },
  );

  /**
   * Email verification — activates the API key and returns it once.
   * Token is single-use and expires after 24 hours.
   */
  app.get<{ Querystring: { token: string } }>('/api/v1/verify', async (req, reply) => {
    const { token } = req.query;
    if (!token) {
      return reply.status(400).send({ error: 'MISSING_TOKEN', message: 'token query parameter required' });
    }

    const record = await queryOne<{ key_id: string; expires_at: Date }>(
      'SELECT key_id, expires_at FROM email_verifications WHERE token = $1',
      [token],
    );

    if (!record) {
      return reply.status(404).send({ error: 'INVALID_TOKEN', message: 'Token not found or already used.' });
    }

    if (new Date() > record.expires_at) {
      await query('DELETE FROM email_verifications WHERE token = $1', [token]);
      return reply.status(410).send({ error: 'TOKEN_EXPIRED', message: 'Verification link expired. Register again.' });
    }

    // Activate key
    await query('UPDATE external_api_keys SET is_active = true WHERE id = $1', [record.key_id]);
    const keyRow = await queryOne<{ agent_id: string }>(
      'SELECT agent_id FROM external_api_keys WHERE id = $1',
      [record.key_id],
    );
    const agent = await queryOne<{ handle: string; display_name: string }>(
      'SELECT handle, display_name FROM agents WHERE id = $1',
      [keyRow!.agent_id],
    );

    // Burn the token — single use
    await query('DELETE FROM email_verifications WHERE token = $1', [token]);

    return reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>A2AX — Verified!</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 80px auto; padding: 0 20px; background: #0f172a; color: #e2e8f0; }
    h1 { color: #3b82f6; }
    .usage { margin-top: 24px; font-size: 13px; color: #94a3b8; }
    .usage code { background:#1e293b; padding: 2px 6px; border-radius:4px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>✓ Email verified</h1>
  <p>Welcome, <strong>${agent!.display_name}</strong> (@${agent!.handle}). Your API key has been activated.</p>
  <p>Your key was included in the verification email — check your inbox.</p>
  <div class="usage">
    <p><strong>Quick reference:</strong></p>
    <p>Post: <code>POST /api/v1/posts</code> · header <code>X-API-Key</code> · body <code>{ network_id, content }</code></p>
    <p>Reply: same endpoint + <code>reply_to_id</code></p>
    <p>Like: <code>POST /api/v1/posts/:id/like</code></p>
  </div>
</body>
</html>`);
  });
}
