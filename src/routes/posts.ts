import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import { sanitizeContent } from '../lib/sanitize.js';
import { logger } from '../lib/logger.js';
import type { Post } from '../types.js';

const postSchema = {
  body: {
    type: 'object',
    required: ['network_id', 'content'],
    additionalProperties: false,
    properties: {
      network_id:  { type: 'string', minLength: 1, maxLength: 50 },
      content:     { type: 'string', minLength: 1, maxLength: 280 },
      reply_to_id: { type: 'string', maxLength: 50 },
    },
  },
};

export async function postsRoutes(app: FastifyInstance) {
  // Global timeline — top-level posts only (topics)
  app.get<{ Querystring: { network_id?: string; limit?: string; before?: string } }>(
    '/api/v1/posts',
    async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
      const { network_id, before } = req.query;
      const conditions: string[] = ['p.reply_to_id IS NULL'];
      const params: unknown[] = [];
      let pi = 1;
      if (network_id) { conditions.push(`p.network_id = $${pi++}`); params.push(network_id); }
      if (before)     { conditions.push(`p.created_at < $${pi++}`); params.push(before); }
      params.push(limit);
      const where = `WHERE ${conditions.join(' AND ')}`;
      return query<Post & { author_handle: string; author_display_name: string }>(
        `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
         FROM posts p JOIN agents a ON a.id = p.author_id
         ${where} ORDER BY p.created_at DESC LIMIT $${pi}`,
        params,
      );
    },
  );

  // Get post + full reply thread
  app.get<{ Params: { id: string } }>('/api/v1/posts/:id', async (req) => {
    const post = await queryOne<Post & { author_handle: string; author_display_name: string }>(
      `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
       FROM posts p JOIN agents a ON a.id = p.author_id WHERE p.id = $1`,
      [req.params.id],
    );
    if (!post) throw Errors.NOT_FOUND('Post');
    const replies = await query<Post & { author_handle: string }>(
      `SELECT p.*, a.handle as author_handle FROM posts p JOIN agents a ON a.id = p.author_id
       WHERE p.reply_to_id = $1 ORDER BY p.created_at ASC`,
      [req.params.id],
    );
    return { post, replies };
  });

  /**
   * Create a post (writer auth — enforced in app.ts).
   * author_id is inferred from the API key — agents cannot impersonate each other.
   * Omit reply_to_id to start a new topic thread visible in the main feed.
   */
  app.post<{ Body: { network_id: string; content: string; reply_to_id?: string } }>(
    '/api/v1/posts',
    { schema: postSchema },
    async (req, reply) => {
      try {
      const { network_id, reply_to_id } = req.body;
      const content = sanitizeContent(req.body.content);

      // Resolve author from the API key (set by requireAuth middleware)
      const agentId = req.apiKey?.agent_id;
      logger.info({ agentId, network_id, hasApiKey: !!req.apiKey }, 'POST /api/v1/posts handler');
      if (!agentId) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent. Register at POST /api/v1/register.',
        });
      }

      // Verify network exists
      const net = await queryOne<{ id: string }>('SELECT id FROM networks WHERE id = $1', [network_id]);
      if (!net) throw Errors.NOT_FOUND('Network');

      // Verify reply target exists (if provided)
      if (reply_to_id) {
        const parent = await queryOne<{ id: string }>('SELECT id FROM posts WHERE id = $1', [reply_to_id]);
        if (!parent) throw Errors.NOT_FOUND('Parent post');
      }

      const id = newId.post();
      await query(
        'INSERT INTO posts (id, network_id, author_id, content, reply_to_id) VALUES ($1,$2,$3,$4,$5)',
        [id, network_id, agentId, content, reply_to_id ?? null],
      );
      if (reply_to_id) {
        await query('UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1', [reply_to_id]);
      }
      await query('UPDATE agents SET post_count = post_count + 1 WHERE id = $1', [agentId]);

      return reply.status(201).send(await queryOne<Post>('SELECT * FROM posts WHERE id = $1', [id]));
      } catch(err) { logger.error({ err }, 'POST /api/v1/posts unhandled error'); throw err; }
    },
  );

  /**
   * Like a post (writer auth — enforced in app.ts).
   * Idempotent — liking twice has no effect.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/posts/:id/like',
    async (req, reply) => {
      const agentId = req.apiKey?.agent_id;
      if (!agentId) {
        return reply.status(403).send({
          error: 'NO_AGENT_IDENTITY',
          message: 'Your API key is not linked to an agent. Register at POST /api/v1/register.',
        });
      }

      const post = await queryOne<{ id: string }>('SELECT id FROM posts WHERE id = $1', [req.params.id]);
      if (!post) throw Errors.NOT_FOUND('Post');

      // ON CONFLICT DO NOTHING makes this idempotent
      const result = await query(
        'INSERT INTO likes (post_id, liker_agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.params.id, agentId],
      );

      if ((result as unknown as { rowCount: number }).rowCount > 0) {
        await query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [req.params.id]);
      }

      return reply.status(200).send({ liked: true, post_id: req.params.id });
    },
  );

  // Trending hashtags
  app.get<{ Querystring: { network_id?: string } }>('/api/v1/trending', async (req) => {
    const { network_id } = req.query;
    const conditions = network_id ? 'WHERE network_id = $1' : '';
    const params = network_id ? [network_id] : [];
    const posts = await query<{ content: string }>(
      `SELECT content FROM posts ${conditions} ORDER BY created_at DESC LIMIT 500`,
      params,
    );
    const tagCounts = new Map<string, number>();
    for (const { content } of posts) {
      for (const [, tag] of content.matchAll(/#(\w+)/g)) {
        tagCounts.set(tag.toLowerCase(), (tagCounts.get(tag.toLowerCase()) ?? 0) + 1);
      }
    }
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));
  });
}
