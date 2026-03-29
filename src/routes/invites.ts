import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import type { Invite, Network } from '../types.js';

/**
 * Invitation System Routes
 * 
 * Endpoints:
 * - POST   /api/v1/invites — Create invite (admin/writer)
 * - GET    /api/v1/invites/:code — Validate invite code (public)
 * - POST   /api/v1/invites/:code/accept — Accept invite (writer auth)
 * - GET    /api/v1/invites — List invites (admin)
 * - DELETE /api/v1/invites/:id — Revoke invite (admin)
 */

export async function invitesRoutes(app: FastifyInstance) {
  // Create invite (admin-only via onRoute hook)
  app.post<{ Body: { network_id: string; expires_days?: number; max_uses?: number; message?: string } }>(
    '/api/v1/invites',
    async (req, reply) => {
      const apiKey = req.apiKey;
      const creatorId = apiKey?.agent_id ?? 'admin';

      const { network_id, expires_days, max_uses, message } = req.body;

      // Validate network exists
      const network = await queryOne<Network>(
        'SELECT id, status FROM networks WHERE id = $1',
        [network_id]
      );

      if (!network) {
        throw Errors.NOT_FOUND('Network');
      }

      if (network.status === 'completed') {
        return reply.status(400).send({
          error: 'NETWORK_COMPLETED',
          message: 'Cannot invite to completed network',
        });
      }

      const id = newId.invite();
      const code = `juno_invite_${Math.random().toString(36).substring(2, 14)}`;
      const expiresAt = expires_days 
        ? new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await query(
        `INSERT INTO invites (id, code, network_id, created_by, status, expires_at, max_uses, message)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)`,
        [id, code, network_id, creatorId, expiresAt, max_uses ?? 1, message ?? null]
      );

      return reply.status(201).send({
        success: true,
        invite: {
          id,
          code,
          network_id,
          network_name: network.name,
          expires_days,
          max_uses: max_uses ?? 1,
          accept_url: `https://a2ax.fly.dev/invites/${code}`,
        },
      });
    }
  );

  // Validate invite code (public - for invite landing page)
  app.get<{ Params: { code: string } }>(
    '/api/v1/invites/:code',
    async (req) => {
      const invite = await queryOne<Invite & { network_name: string }>(
        `SELECT i.*, n.name as network_name
         FROM invites i
         JOIN networks n ON n.id = i.network_id
         WHERE i.code = $1`,
        [req.params.code]
      );

      if (!invite) {
        throw Errors.NOT_FOUND('Invite');
      }

      // Check expiration
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return {
          valid: false,
          reason: 'expired',
          message: 'This invite has expired',
        };
      }

      // Check revocation
      if (invite.status === 'revoked') {
        return {
          valid: false,
          reason: 'revoked',
          message: 'This invite has been revoked',
        };
      }

      // Check usage limit
      if (invite.uses_count >= invite.max_uses) {
        return {
          valid: false,
          reason: 'max_uses_reached',
          message: 'This invite has reached its usage limit',
        };
      }

      return {
        valid: true,
        invite: {
          code: invite.code,
          network_id: invite.network_id,
          network_name: invite.network_name,
          message: invite.message,
        },
      };
    }
  );

  // Accept invite (requires writer auth)
  app.post<{ Params: { code: string } }>(
    '/api/v1/invites/:code/accept',
    async (req, reply) => {
      const apiKey = (req as unknown as { apiKey?: { agent_id?: string } }).apiKey;
      if (!apiKey?.agent_id) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent.',
        });
      }

      const invite = await queryOne<Invite>(
        'SELECT * FROM invites WHERE code = $1',
        [req.params.code]
      );

      if (!invite) {
        throw Errors.NOT_FOUND('Invite');
      }

      // Check expiration
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return reply.status(400).send({
          error: 'INVITE_EXPIRED',
          message: 'This invite has expired',
        });
      }

      // Check revocation
      if (invite.status === 'revoked') {
        return reply.status(400).send({
          error: 'INVITE_REVOKED',
          message: 'This invite has been revoked',
        });
      }

      // Check usage limit
      if (invite.uses_count >= invite.max_uses) {
        return reply.status(400).send({
          error: 'INVITE_MAX_USES',
          message: 'This invite has reached its usage limit',
        });
      }

      // Update agent's network assignment
      await query(
        'UPDATE agents SET network_id = $1 WHERE id = $2',
        [invite.network_id, apiKey.agent_id]
      );

      // Update invite status
      if (invite.uses_count + 1 >= invite.max_uses) {
        await query(
          'UPDATE invites SET status = $1, uses_count = uses_count + 1, accepted_at = NOW() WHERE id = $2',
          ['accepted', invite.id]
        );
      } else {
        await query(
          'UPDATE invites SET uses_count = uses_count + 1, accepted_at = NOW() WHERE id = $1',
          [invite.id]
        );
      }

      return reply.send({
        success: true,
        message: `Joined network ${invite.network_id}`,
        network_id: invite.network_id,
      });
    }
  );

  // List invites (admin only)
  app.get('/api/v1/invites', async (req) => {
    const invites = await query<Invite & { network_name: string; creator_handle: string }>(
      `SELECT i.*, n.name as network_name, a.handle as creator_handle
       FROM invites i
       JOIN networks n ON n.id = i.network_id
       JOIN agents a ON a.id = i.created_by
       ORDER BY i.created_at DESC`
    );

    return invites;
  });

  // Revoke invite (admin only)
  app.delete<{ Params: { id: string } }>(
    '/api/v1/invites/:id',
    async (req, reply) => {
      await query(
        'UPDATE invites SET status = $1 WHERE id = $2',
        ['revoked', req.params.id]
      );

      return reply.send({
        success: true,
        message: 'Invite revoked',
      });
    }
  );
}
