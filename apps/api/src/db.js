import { createClient } from '@libsql/client';
import { DEFAULT_SETTINGS } from '@deposit-studio/shared';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const localPath = resolve(here, '../../../data/deposit-studio.db').replaceAll('\\', '/');
mkdirSync(dirname(localPath), { recursive:true });
const url = process.env.TURSO_DATABASE_URL || `file:${localPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN;
export const db = createClient({ url, authToken });

export async function initializeDatabase() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS broadcast_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      display_after TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES broadcast_sessions(id),
      donor_name TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0),
      bank TEXT NOT NULL,
      external_id TEXT UNIQUE,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ]);
  if (!await activeSession()) {
    await db.execute({ sql: 'INSERT INTO broadcast_sessions (title) VALUES (?)', args: ['첫 방송'] });
  }
  await db.execute({ sql: 'INSERT OR IGNORE INTO settings (id, value) VALUES (1, ?)', args: [JSON.stringify(DEFAULT_SETTINGS)] });
}

export async function activeSession() {
  const result = await db.execute('SELECT * FROM broadcast_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1');
  return result.rows[0] || null;
}
