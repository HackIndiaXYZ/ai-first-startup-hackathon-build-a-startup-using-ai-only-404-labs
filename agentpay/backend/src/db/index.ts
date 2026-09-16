import { Pool } from 'pg';
import { config } from '../config';

const isLocalhost = !config.databaseUrl || config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1');

export const db = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

db.on('error', (err) => {
  console.error('Unexpected DB pool error', err);
});

export async function testDbConnection(): Promise<void> {
  const client = await db.connect();
  await client.query('SELECT 1');
  client.release();
}
