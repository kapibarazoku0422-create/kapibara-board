import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from '../src/config.js';

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const client = new pg.Client({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

try {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const directory = path.join(process.cwd(), 'db', 'migrations');
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.sql')).sort();

  for (const filename of files) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
    if (applied.rowCount) {
      console.log(`skip ${filename}`);
      continue;
    }

    const sql = await fs.readFile(path.join(directory, filename), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await client.end();
}
