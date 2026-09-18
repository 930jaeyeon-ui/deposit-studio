import express from 'express';
import { DEFAULT_SETTINGS, normalizeDonation } from '@deposit-studio/shared';
import { activeSession, db } from './db.js';

export const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.WEB_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '100kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/dashboard', (_req, res) => {
  const session = activeSession();
  const donations = db.prepare(`SELECT id, donor_name donorName, amount, bank, received_at receivedAt
    FROM donations WHERE session_id = ? ORDER BY id DESC LIMIT 100`).all(session.id);
  const ranking = db.prepare(`SELECT donor_name donorName, SUM(amount) amount, COUNT(*) count
    FROM donations WHERE session_id = ? GROUP BY donor_name ORDER BY amount DESC, donor_name`).all(session.id);
  res.json({ session, donations, ranking });
});

app.get('/api/widgets', (_req, res) => {
  const session = activeSession();
  const donations = db.prepare(`SELECT id, donor_name donorName, amount, received_at receivedAt
    FROM donations WHERE session_id = ? AND received_at >= ? ORDER BY id DESC LIMIT 20`).all(session.id, session.display_after);
  const ranking = db.prepare(`SELECT donor_name donorName, SUM(amount) amount, COUNT(*) count
    FROM donations WHERE session_id = ? AND received_at >= ? GROUP BY donor_name ORDER BY amount DESC, donor_name LIMIT 20`).all(session.id, session.display_after);
  res.json({ donations, ranking });
});

app.get('/api/donations', (req, res) => {
  const after = Math.max(0, Number(req.query.after) || 0);
  const session = activeSession();
  const rows = db.prepare(`SELECT id, donor_name donorName, amount, bank, received_at receivedAt
    FROM donations WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT 50`).all(session.id, after);
  res.json(rows);
});

app.post('/api/donations', (req, res) => {
  try {
    const input = normalizeDonation(req.body);
    const session = activeSession();
    const result = db.prepare(`INSERT INTO donations (session_id, donor_name, amount, bank, external_id)
      VALUES (?, ?, ?, ?, ?)`).run(session.id, input.donorName, input.amount, input.bank, input.externalId);
    const row = db.prepare(`SELECT id, donor_name donorName, amount, bank, received_at receivedAt FROM donations WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (error) {
    const duplicate = String(error.message).includes('UNIQUE constraint');
    res.status(duplicate ? 409 : 400).json({ error: duplicate ? '이미 처리한 입금입니다.' : error.message });
  }
});

app.get('/api/settings', (_req, res) => {
  const row = db.prepare('SELECT value FROM settings WHERE id = 1').get();
  res.json({ ...DEFAULT_SETTINGS, ...JSON.parse(row.value) });
});

app.put('/api/settings', (req, res) => {
  const settings = { ...DEFAULT_SETTINGS, ...req.body };
  db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run(JSON.stringify(settings));
  res.json(settings);
});

app.post('/api/sessions', (req, res) => {
  const current = activeSession();
  db.prepare('UPDATE broadcast_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?').run(current.id);
  const title = String(req.body?.title || `방송 ${current.id + 1}회차`).trim().slice(0, 60);
  const result = db.prepare('INSERT INTO broadcast_sessions (title) VALUES (?)').run(title);
  res.status(201).json(db.prepare('SELECT * FROM broadcast_sessions WHERE id = ?').get(result.lastInsertRowid));
});

app.post('/api/display/reset', (_req, res) => {
  db.prepare('UPDATE broadcast_sessions SET display_after = CURRENT_TIMESTAMP WHERE id = ?').run(activeSession().id);
  res.json({ ok: true });
});

app.post('/api/display/restore', (_req, res) => {
  db.prepare('UPDATE broadcast_sessions SET display_after = started_at WHERE id = ?').run(activeSession().id);
  res.json({ ok: true });
});
