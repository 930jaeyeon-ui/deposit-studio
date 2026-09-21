import { createHash } from 'node:crypto';

const WIDGET_URL = 'https://toon.at/widget/alertbox/{}';
const SOCKET_URL = 'wss://ws.toon.at/{}';

export function toonationWidgetKey(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  if (/^[A-Za-z0-9_-]{8,512}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'toon.at' || url.port || url.username || url.password || url.search || url.hash) return '';
    return /^\/widget\/alertbox\/([A-Za-z0-9_-]{8,512})\/?$/.exec(url.pathname)?.[1] || '';
  } catch {
    return '';
  }
}

export function parseToonationPayload(raw) {
  if (!raw || String(raw).startsWith('#')) return null;
  try {
    let content = JSON.parse(String(raw))?.content;
    if (typeof content === 'string') content = JSON.parse(content);
    if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
    const amount = Math.trunc(Number(String(content.amount).replaceAll(',', '')));
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) return null;
    const gradeSource = content.title_info;
    const grade = typeof gradeSource === 'object' ? gradeSource?.name : typeof gradeSource === 'string' ? gradeSource : '';
    return {
      donorName:String(content.name || '익명').trim().slice(0,40) || '익명',
      amount,
      message:String(content.message || '').trim().slice(0,2000),
      grade:String(grade || '').trim().slice(0,30)
    };
  } catch {
    return null;
  }
}

function socketToken(html) {
  const match = String(html).match(/window\.payload\s*=\s*JSON\.parse\(\s*"((?:\\.|[^"\\])*)"\s*\)/s);
  if (match) {
    try {
      const parsed = JSON.parse(JSON.parse(`"${match[1]}"`));
      if (parsed?.payload) return String(parsed.payload);
    } catch {}
  }
  return String(html).match(/"payload"\s*:\s*"([^"\\]+)"/)?.[1] || '';
}

class Connection {
  constructor(userId, key, onDonation, onStatus) {
    this.userId = Number(userId);
    this.key = key;
    this.onDonation = onDonation;
    this.onStatus = onStatus;
    this.stopped = false;
    this.socket = null;
    this.timer = null;
    this.seen = new Map();
  }
  start() { this.connect(); }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }
  async connect() {
    if (this.stopped) return;
    this.onStatus(this.userId, { state:'connecting', text:'투네이션 연결 중' });
    try {
      const response = await fetch(WIDGET_URL.replace('{}', encodeURIComponent(this.key)), { signal:AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const token = socketToken(await response.text());
      if (!token) throw new Error('위젯 연결 정보를 찾을 수 없습니다.');
      this.listen(token);
    } catch (error) {
      this.retry(error.message);
    }
  }
  listen(token) {
    if (this.stopped) return;
    const socket = new WebSocket(SOCKET_URL.replace('{}', encodeURIComponent(token)));
    this.socket = socket;
    let lastMessageAt = Date.now();
    const heartbeat = setInterval(() => {
      if (Date.now() - lastMessageAt > 120000) return socket.close();
      if (socket.readyState === WebSocket.OPEN) socket.send('#ping');
    }, 20000);
    socket.addEventListener('open', () => this.onStatus(this.userId, { state:'connected', text:'투네이션 연결됨' }));
    socket.addEventListener('message', event => {
      lastMessageAt = Date.now();
      const donation = parseToonationPayload(event.data);
      if (!donation || this.duplicate(donation)) return;
      Promise.resolve(this.onDonation(this.userId, donation)).catch(error => console.error('투네이션 후원 저장 실패:', error.message));
    });
    socket.addEventListener('error', () => {});
    socket.addEventListener('close', () => {
      clearInterval(heartbeat);
      if (this.socket === socket) this.socket = null;
      this.retry('투네이션 연결 끊김 · 다시 연결 중');
    });
  }
  duplicate(donation) {
    const now = Date.now();
    for (const [key, at] of this.seen) if (now - at > 60000) this.seen.delete(key);
    const key = createHash('sha256').update(`${donation.donorName}|${donation.amount}|${donation.message}`).digest('hex').slice(0,20);
    if (this.seen.has(key)) return true;
    this.seen.set(key, now);
    return false;
  }
  retry(message) {
    if (this.stopped) return;
    this.onStatus(this.userId, { state:'retrying', text:message || '투네이션 재연결 중' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), 10000);
  }
}

export class ToonationManager {
  constructor(onDonation) {
    this.onDonation = onDonation;
    this.connections = new Map();
    this.statuses = new Map();
  }
  status(userId) {
    return this.statuses.get(Number(userId)) || { state:'disabled', text:'투네이션 수신 꺼짐' };
  }
  configure(userId, settings) {
    const id = Number(userId);
    const key = toonationWidgetKey(settings?.toonationWidgetUrl);
    const existing = this.connections.get(id);
    if (existing && existing.key === key && settings?.toonationEnabled) return;
    existing?.stop();
    this.connections.delete(id);
    if (!settings?.toonationEnabled) return this.setStatus(id, { state:'disabled', text:'투네이션 수신 꺼짐' });
    if (!key) return this.setStatus(id, { state:'error', text:'투네이션 위젯 URL을 확인해주세요.' });
    const connection = new Connection(id, key, this.onDonation, (target, status) => this.setStatus(target, status));
    this.connections.set(id, connection);
    connection.start();
  }
  reconnect(userId, settings) {
    this.connections.get(Number(userId))?.stop();
    this.connections.delete(Number(userId));
    this.configure(userId, settings);
  }
  setStatus(userId, status) { this.statuses.set(Number(userId), { ...status, changedAt:new Date().toISOString() }); }
}
