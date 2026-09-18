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
app.get('/api/health', (_req, res) => res.json({ ok:true }));

app.get('/api/dashboard', async (_req, res) => {
  const session = await activeSession();
  const [donations, ranking] = await Promise.all([
    db.execute({ sql:`SELECT id, donor_name donorName, amount, bank, received_at receivedAt FROM donations WHERE session_id = ? ORDER BY id DESC LIMIT 100`, args:[session.id] }),
    db.execute({ sql:`SELECT donor_name donorName, SUM(amount) amount, COUNT(*) count FROM donations WHERE session_id = ? GROUP BY donor_name ORDER BY amount DESC, donor_name`, args:[session.id] })
  ]);
  res.json({ session, donations:donations.rows, ranking:ranking.rows });
});

app.get('/api/widgets', async (_req, res) => {
  const session = await activeSession();
  const [donations, ranking] = await Promise.all([
    db.execute({ sql:`SELECT id, donor_name donorName, amount, received_at receivedAt FROM donations WHERE session_id = ? AND received_at >= ? ORDER BY id DESC LIMIT 20`, args:[session.id,session.display_after] }),
    db.execute({ sql:`SELECT donor_name donorName, SUM(amount) amount, COUNT(*) count FROM donations WHERE session_id = ? AND received_at >= ? GROUP BY donor_name ORDER BY amount DESC, donor_name LIMIT 20`, args:[session.id,session.display_after] })
  ]);
  res.json({ donations:donations.rows, ranking:ranking.rows });
});

app.get('/api/donations', async (req, res) => {
  const after = Math.max(0, Number(req.query.after) || 0);
  const session = await activeSession();
  const result = await db.execute({ sql:`SELECT id, donor_name donorName, amount, bank, received_at receivedAt FROM donations WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT 50`, args:[session.id,after] });
  res.json(result.rows);
});

app.post('/api/donations', async (req, res) => {
  try {
    const input = normalizeDonation(req.body);
    const session = await activeSession();
    const result = await db.execute({ sql:`INSERT INTO donations (session_id, donor_name, amount, bank, external_id) VALUES (?, ?, ?, ?, ?)`, args:[session.id,input.donorName,input.amount,input.bank,input.externalId] });
    const saved = await db.execute({ sql:`SELECT id, donor_name donorName, amount, bank, received_at receivedAt FROM donations WHERE id = ?`, args:[result.lastInsertRowid] });
    res.status(201).json(saved.rows[0]);
  } catch (error) {
    const duplicate = String(error.message).includes('UNIQUE constraint');
    res.status(duplicate ? 409 : 400).json({ error:duplicate ? '이미 처리한 입금입니다.' : error.message });
  }
});

app.get('/api/settings', async (_req, res) => {
  const result = await db.execute('SELECT value FROM settings WHERE id = 1');
  res.json({ ...DEFAULT_SETTINGS, ...JSON.parse(result.rows[0].value) });
});

app.put('/api/settings', async (req, res) => {
  const settings = { ...DEFAULT_SETTINGS, ...req.body };
  await db.execute({ sql:`UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`, args:[JSON.stringify(settings)] });
  res.json(settings);
});

app.post('/api/sessions', async (req, res) => {
  const current = await activeSession();
  await db.execute({ sql:'UPDATE broadcast_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?', args:[current.id] });
  const title = String(req.body?.title || `방송 ${Number(current.id)+1}회차`).trim().slice(0,60);
  const result = await db.execute({ sql:'INSERT INTO broadcast_sessions (title) VALUES (?)', args:[title] });
  const created = await db.execute({ sql:'SELECT * FROM broadcast_sessions WHERE id = ?', args:[result.lastInsertRowid] });
  res.status(201).json(created.rows[0]);
});

app.post('/api/display/reset', async (_req, res) => {
  const session = await activeSession();
  await db.execute({ sql:'UPDATE broadcast_sessions SET display_after = CURRENT_TIMESTAMP WHERE id = ?', args:[session.id] });
  res.json({ ok:true });
});

app.post('/api/display/restore', async (_req, res) => {
  const session = await activeSession();
  await db.execute({ sql:'UPDATE broadcast_sessions SET display_after = started_at WHERE id = ?', args:[session.id] });
  res.json({ ok:true });
});
