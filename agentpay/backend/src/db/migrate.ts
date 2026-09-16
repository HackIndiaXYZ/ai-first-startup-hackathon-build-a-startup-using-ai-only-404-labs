import * as fs from 'fs';
import * as path from 'path';
import { db } from './index';

async function migrate(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  // Ensure migrations tracking table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const { rows } = await db.query('SELECT 1 FROM _migrations WHERE filename = $1', [file]);
    if (rows.length > 0) {
      console.log(`⏭  Skipping ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`⚡ Applying ${file}...`);
    await db.query(sql);
    await db.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    console.log(`✅ Applied ${file}`);
  }

  await db.end();
  console.log('✅ All migrations complete');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
