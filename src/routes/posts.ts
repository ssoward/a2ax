import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import { sanitizeContent } from '../lib/sanitize.js';
import type { Post } from '../types.js';

const injectPostSchema = {
  body: {
    type: 'object',
    required: ['network_id', 'author_id', 'content'],
    additionalProperties: false,
    properties: {
      network_id:  { type: 'string', minLength: 1, maxLength: 50 },
      author_id:   { type: 'string', minLength: 1, maxLength: 50 },
      content:     { type: 'string', minLength: 1, maxLength: 280 },
      reply_to_id: { type: 'string', maxLength: 50 },
    },
  },
};

export async function postsRoutes(app: FastifyInstance) {
  // Global timeline
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

  // Get post + thread
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

  // Manual post injection (writer + admin — enforced in app.ts)
  app.post<{ Body: { network_id: string; author_id: string; content: string; reply_to_id?: string } }>(
    '/api/v1/posts',
    { schema: injectPostSchema },
    async (req) => {
      const { network_id, author_id, reply_to_id } = req.body;
      const content = sanitizeContent(req.body.content);
      const id = newId.post();
      await query(
        'INSERT INTO posts (id, network_id, author_id, content, reply_to_id) VALUES ($1,$2,$3,$4,$5)',
        [id, network_id, author_id, content, reply_to_id ?? null],
      );
      if (reply_to_id) {
        await query('UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1', [reply_to_id]);
      }
      return queryOne<Post>('SELECT * FROM posts WHERE id = $1', [id]);
    },
  );

  // Trending topics
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
