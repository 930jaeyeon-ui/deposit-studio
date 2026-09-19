import { createClient } from '@libsql/client';
import { DEFAULT_SETTINGS } from '@deposit-studio/shared';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword } from './password.js';

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
      recipient_user_id INTEGER REFERENCES users(id),
      donor_name TEXT NOT NULL,
      donor_override_name TEXT,
      amount INTEGER NOT NULL CHECK(amount > 0),
      bank TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'included',
      external_id TEXT UNIQUE,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super','admin','member')),
      password_hash TEXT NOT NULL,
      avatar_path TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS web_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS donor_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      raw_name TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(recipient_user_id, raw_name)
    )`,
    `CREATE TABLE IF NOT EXISTS donor_name_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donation_id INTEGER NOT NULL REFERENCES donations(id),
      changed_by_user_id INTEGER NOT NULL REFERENCES users(id),
      raw_name TEXT NOT NULL,
      canonical_name TEXT,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS donation_status_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donation_id INTEGER NOT NULL REFERENCES donations(id),
      changed_by_user_id INTEGER NOT NULL REFERENCES users(id),
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ]);
  const donationColumns = new Set((await db.execute(`PRAGMA table_info(donations)`)).rows.map(column => column.name));
  if (!donationColumns.has('recipient_user_id')) await db.execute(`ALTER TABLE donations ADD COLUMN recipient_user_id INTEGER REFERENCES users(id)`);
  if (!donationColumns.has('donor_override_name')) await db.execute(`ALTER TABLE donations ADD COLUMN donor_override_name TEXT`);
  if (!donationColumns.has('status')) await db.execute(`ALTER TABLE donations ADD COLUMN status TEXT NOT NULL DEFAULT 'included'`);
  if (!await activeSession()) {
    await db.execute({ sql: 'INSERT INTO broadcast_sessions (title) VALUES (?)', args: ['첫 방송'] });
  }
  await db.execute({ sql: 'INSERT OR IGNORE INTO settings (id, value) VALUES (1, ?)', args: [JSON.stringify(DEFAULT_SETTINGS)] });
  const users = [
    ['admin','폴조지','super',null],
    ['chan808','차니','admin','/avatars/chan808.png'],
    ['m1562','오뚝2','admin','/avatars/m1562.png'],
    ['hh01','요한','member','/avatars/hh01.png'],
    ['up555','오기','member','/avatars/up555.png'],
    ['tko003','강구','member','/avatars/tko003.png'],
    ['djun27','디준','member','/avatars/djun27.png'],
    ['g9701','경인','member','/avatars/g9701.png'],
    ['ssam572','민권','member','/avatars/ssam572.png']
  ];
  for (const [loginId, displayName, role, avatar] of users) {
    await db.execute({ sql:`INSERT OR IGNORE INTO users (login_id, display_name, role, password_hash, avatar_path) VALUES (?, ?, ?, ?, ?)`, args:[loginId,displayName,role,hashPassword(role === 'super' ? 'Init1357!!' : 'Init1234!!'),avatar] });
  }
  await db.execute(`INSERT OR IGNORE INTO user_settings (user_id, value) SELECT id, COALESCE((SELECT value FROM settings WHERE id = 1), '${JSON.stringify(DEFAULT_SETTINGS).replaceAll("'", "''")}') FROM users`);
  const passwordMigration = await db.execute({ sql:`SELECT value FROM app_meta WHERE key = ?`, args:['member_initial_password_v2'] });
  if (!passwordMigration.rows.length) {
    const members = await db.execute(`SELECT id, password_hash passwordHash FROM users WHERE role <> 'super'`);
    for (const member of members.rows) {
      if (verifyPassword('Init1357!!', member.passwordHash)) {
        await db.execute({ sql:`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, args:[hashPassword('Init1234!!'),member.id] });
        await db.execute({ sql:`DELETE FROM web_sessions WHERE user_id = ?`, args:[member.id] });
      }
    }
    await db.execute({ sql:`INSERT INTO app_meta (key, value) VALUES (?, ?)`, args:['member_initial_password_v2','Init1234'] });
  }
  await db.execute(`UPDATE donations SET recipient_user_id = (SELECT id FROM users WHERE login_id = 'm1562') WHERE recipient_user_id IS NULL`);
  await db.execute(`DELETE FROM web_sessions WHERE expires_at <= CURRENT_TIMESTAMP`);
}

export async function activeSession() {
  const result = await db.execute('SELECT * FROM broadcast_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1');
  return result.rows[0] || null;
}
