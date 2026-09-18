import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '@deposit-studio/shared';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || resolve(here, '../../../data/deposit-studio.db');
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS broadcast_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    display_after TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES broadcast_sessions(id),
    donor_name TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount > 0),
    bank TEXT NOT NULL,
    external_id TEXT UNIQUE,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

if (!db.prepare('SELECT id FROM broadcast_sessions WHERE ended_at IS NULL LIMIT 1').get()) {
  db.prepare('INSERT INTO broadcast_sessions (title) VALUES (?)').run('첫 방송');
}
db.prepare('INSERT OR IGNORE INTO settings (id, value) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SETTINGS));

export function activeSession() {
  return db.prepare('SELECT * FROM broadcast_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').get();
}
