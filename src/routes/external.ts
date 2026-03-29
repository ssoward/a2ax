import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import type { Agent, Network } from '../types.js';

/**
 * External Agent Routes
 * 
 * Endpoints for external agents (authenticated via API key):
 * - POST /api/v1/external/networks — Create a new network
 * - POST /api/v1/external/networks/:id/join — Join an existing network
 * - GET  /api/v1/external/networks — List joinable networks
 * - PUT  /api/v1/external/agent/network — Update agent's network assignment
 */

export async function externalRoutes(app: FastifyInstance) {
  // List networks that external agents can join (running or pending, not completed)
  app.get('/api/v1/external/networks', async () => {
    return query<Network>(
      `SELECT id, name, topic, status, tick_interval_seconds, max_ticks, current_tick, created_at
       FROM networks 
       WHERE status IN ('pending', 'running')
       ORDER BY created_at DESC`
    );
  });

  // Create a new network (external agent with writer auth)
  app.post<{ Body: { name: string; topic: string; tick_interval_seconds?: number; max_ticks?: number } }>(
    '/api/v1/external/networks',
    async (req, reply) => {
      const apiKey = (req as unknown as { apiKey?: { agent_id?: string } }).apiKey;
      if (!apiKey?.agent_id) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent.',
        });
      }

      const { name, topic, tick_interval_seconds, max_ticks } = req.body;
      
      // Validate input
      if (!name || name.length < 1 || name.length > 100) {
        return reply.status(400).send({ error: 'INVALID_NAME', message: 'Name must be 1-100 characters' });
      }
      if (!topic || topic.length < 1 || topic.length > 500) {
        return reply.status(400).send({ error: 'INVALID_TOPIC', message: 'Topic must be 1-500 characters' });
      }

      const id = newId.network();
      await query(
        `INSERT INTO networks (id, name, topic, tick_interval_seconds, max_ticks, status) 
         VALUES ($1,$2,$3,$4,$5,'pending')`,
        [id, name, topic, tick_interval_seconds ?? 30, max_ticks ?? 50]
      );

      // Assign the creating agent to this network
      await query(
        `UPDATE agents SET network_id = $1 WHERE id = $2`,
        [id, apiKey.agent_id]
      );

      return reply.status(201).send({
        success: true,
        network: await queryOne<Network>('SELECT * FROM networks WHERE id = $1', [id]),
      });
    }
  );

  // Join an existing network (external agent with writer auth)
  app.post<{ Params: { id: string } }>(
    '/api/v1/external/networks/:id/join',
    async (req, reply) => {
      const apiKey = (req as unknown as { apiKey?: { agent_id?: string } }).apiKey;
      if (!apiKey?.agent_id) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent.',
        });
      }

      const network = await queryOne<Network>(
        'SELECT id, status FROM networks WHERE id = $1',
        [req.params.id]
      );

      if (!network) {
        throw Errors.NOT_FOUND('Network');
      }

      if (network.status === 'completed') {
        return reply.status(400).send({
          error: 'NETWORK_COMPLETED',
          message: 'This network has already completed. Cannot join.',
        });
      }

      // Update agent's network assignment
      await query(
        `UPDATE agents SET network_id = $1 WHERE id = $2`,
        [req.params.id, apiKey.agent_id]
      );

      return reply.send({
        success: true,
        message: `Joined network ${network.id}`,
        network,
      });
    }
  );

  // Update agent's network assignment (for reassignment)
  app.put<{ Body: { network_id?: string } }>(
    '/api/v1/external/agent/network',
    async (req, reply) => {
      const apiKey = (req as unknown as { apiKey?: { agent_id?: string } }).apiKey;
      if (!apiKey?.agent_id) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent.',
        });
      }

      const network_id = req.body.network_id;

      if (network_id) {
        // Validate network exists and is not completed
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
            message: 'Cannot assign to completed network',
          });
        }
      }

      // Update or clear network assignment
      await query(
        `UPDATE agents SET network_id = $1 WHERE id = $2`,
        [network_id ?? null, apiKey.agent_id]
      );

      return reply.send({
        success: true,
        network_id,
      });
    }
  );
}
