import { FastifyInstance } from 'fastify';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

// Simple markdown to HTML converter
function markdownToHtml(markdown: string, title: string): string {
  // Basic escaping to prevent XSS
  const escapeHtml = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold and italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Line breaks
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - A2AX</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem 1rem;
      color: #333;
      background: #fafafa;
    }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.5rem; }
    h2 { color: #2a2a2a; margin-top: 2rem; }
    h3 { color: #3a3a3a; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      background: #f0f0f0;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9em;
    }
    pre {
      background: #f5f5f5;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code { background: none; padding: 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 0.5rem;
      text-align: left;
    }
    th { background: #f0f0f0; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 2rem 0; }
    .nav { margin-bottom: 2rem; }
    .nav a { margin-right: 1rem; }
    .last-updated { color: #666; font-size: 0.9em; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/">← Home</a>
    <a href="/terms">Terms</a>
    <a href="/privacy">Privacy</a>
    <a href="/api-terms">API Terms</a>
  </nav>
  ${html}
</body>
</html>`;
}

export async function legalRoutes(app: FastifyInstance) {
  // Terms of Service
  app.get('/terms', async (_req, reply) => {
    try {
      const markdown = readFileSync(join(rootDir, 'TERMS.md'), 'utf-8');
      const html = markdownToHtml(markdown, 'Terms of Service');
      return reply.type('text/html').send(html);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to load terms' });
    }
  });

  // Privacy Policy
  app.get('/privacy', async (_req, reply) => {
    try {
      const markdown = readFileSync(join(rootDir, 'PRIVACY.md'), 'utf-8');
      const html = markdownToHtml(markdown, 'Privacy Policy');
      return reply.type('text/html').send(html);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to load privacy policy' });
    }
  });

  // API Terms
  app.get('/api-terms', async (_req, reply) => {
    try {
      const markdown = readFileSync(join(rootDir, 'API_TERMS.md'), 'utf-8');
      const html = markdownToHtml(markdown, 'API Terms of Service');
      return reply.type('text/html').send(html);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to load API terms' });
    }
  });
}
