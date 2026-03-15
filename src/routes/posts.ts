import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db/client.js';
import { newId } from '../lib/id.js';
import { Errors } from '../lib/errors.js';
import type { Post } from '../types.js';

export async function postsRoutes(app: FastifyInstance) {
  // Global timeline
  app.get<{
    Querystring: { simulation_id?: string; limit?: string; before?: string };
  }>('/api/v1/posts', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const { simulation_id, before } = req.query;

    const conditions: string[] = ['p.reply_to_id IS NULL']; // top-level only
    const params: unknown[] = [];
    let pi = 1;

    if (simulation_id) {
      conditions.push(`p.simulation_id = $${pi++}`);
      params.push(simulation_id);
    }
    if (before) {
      conditions.push(`p.created_at < $${pi++}`);
      params.push(before);
    }
    params.push(limit);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return query<Post & { author_handle: string; author_display_name: string }>(
      `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
       FROM posts p JOIN agents a ON a.id = p.author_id
       ${where}
       ORDER BY p.created_at DESC LIMIT $${pi}`,
      params,
    );
  });

  // Get post + thread
  app.get<{ Params: { id: string } }>('/api/v1/posts/:id', async (req) => {
    const post = await queryOne<Post & { author_handle: string; author_display_name: string }>(
      `SELECT p.*, a.handle as author_handle, a.display_name as author_display_name
       FROM posts p JOIN agents a ON a.id = p.author_id WHERE p.id = $1`,
      [req.params.id],
    );
    if (!post) throw Errors.NOT_FOUND('Post');

    const replies = await query<Post & { author_handle: string }>(
      `SELECT p.*, a.handle as author_handle FROM posts p
       JOIN agents a ON a.id = p.author_id
       WHERE p.reply_to_id = $1 ORDER BY p.created_at ASC`,
      [req.params.id],
    );

    return { post, replies };
  });

  // Manual post injection
  app.post<{
    Body: { simulation_id: string; author_id: string; content: string; reply_to_id?: string };
  }>('/api/v1/posts', async (req) => {
    const { simulation_id, author_id, content, reply_to_id } = req.body;
    const id = newId.post();
    await query(
      'INSERT INTO posts (id, simulation_id, author_id, content, reply_to_id) VALUES ($1,$2,$3,$4,$5)',
      [id, simulation_id, author_id, content.slice(0, 280), reply_to_id ?? null],
    );
    if (reply_to_id) {
      await query('UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1', [reply_to_id]);
    }
    return queryOne<Post>('SELECT * FROM posts WHERE id = $1', [id]);
  });

  // Trending topics (simple hashtag extraction)
  app.get<{ Querystring: { simulation_id?: string } }>('/api/v1/trending', async (req) => {
    const { simulation_id } = req.query;
    const conditions = simulation_id ? `WHERE simulation_id = $1` : '';
    const params = simulation_id ? [simulation_id] : [];

    // Extract hashtags from recent posts using regex in JS (simpler than PG regex)
    const posts = await query<{ content: string }>(
      `SELECT content FROM posts ${conditions}
       ORDER BY created_at DESC LIMIT 500`,
      params,
    );

    const tagCounts = new Map<string, number>();
    const hashtagRe = /#(\w+)/g;
    for (const { content } of posts) {
      for (const [, tag] of content.matchAll(hashtagRe)) {
        tagCounts.set(tag.toLowerCase(), (tagCounts.get(tag.toLowerCase()) ?? 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));
  });
}
