import { Router } from 'express';
import { randomUUID } from 'node:crypto';

export const apiTest = Router();
const history = [];
const clients = new Set();
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

apiTest.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  send(res, 'snapshot', history);
  clients.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

apiTest.post('/messages', (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type을 application/json으로 설정하세요.' });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'JSON 객체를 보내세요.' });
  }
  const message = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    body: req.body
  };
  history.unshift(message);
  history.length = Math.min(history.length, 100);
  for (const client of clients) send(client, 'message', message);
  res.status(201).json({ ok: true, ...message });
});
