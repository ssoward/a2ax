import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './client.js';
import { logger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await db.query('SELECT 1 FROM migrations WHERE filename = $1', [file]);
    if (rows.length > 0) {
      logger.debug({ file }, 'Migration already applied, skipping');
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await db.query(sql);
    await db.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
    logger.info({ file }, 'Migration applied');
  }

  logger.info('All migrations complete');
  await db.end();
}

migrate().catch(err => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});
