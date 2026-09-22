import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const protoPath = join(dirname(fileURLToPath(import.meta.url)), 'stream_list.proto');
const definition = protoLoader.loadSync(protoPath, {
  keepCase:false,
  longs:String,
  enums:String,
  defaults:false,
  oneofs:true,
});
export const youtubeGrpc = grpc.loadPackageDefinition(definition).youtube.api.v3;

export function createYouTubeGrpcStream({ apiKey, liveChatId, pageToken = '', endpoint = 'youtube.googleapis.com:443', credentials = grpc.credentials.createSsl() }) {
  const client = new youtubeGrpc.V3DataLiveChatMessageService(
    endpoint,
    credentials,
  );
  const metadata = new grpc.Metadata();
  metadata.set('x-goog-api-key', apiKey);
  const call = client.streamList({
    liveChatId,
    pageToken,
    part:['id','snippet','authorDetails'],
  }, metadata);
  call.once('close', () => client.close());
  return call;
}

export function youtubeVideoId(value) {
  const input = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname === 'youtu.be') return /^[A-Za-z0-9_-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : '';
    if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
      const id = url.searchParams.get('v') || /^\/(?:live|shorts)\/([A-Za-z0-9_-]{11})/.exec(url.pathname)?.[1];
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : '';
    }
  } catch {}
  return '';
}

export function parseDonationCommand(text) {
  const match = /^!후원\s+(\S{1,40})\s+(.+)$/u.exec(String(text || '').trim());
  if (!match) return null;
  const donorName = match[1].replace(/\s+/g, '').slice(0, 40);
  const message = match[2].replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!donorName || !message) return null;
  return { donorName, message };
}

export function parseRegistrationCommand(text) {
  const match = /^!후원등록\s+(.{1,40})$/u.exec(String(text || '').trim());
  if (!match) return null;
  const donorName = match[1].trim();
  const donorNormalized = donorName.replace(/\s+/g, '').toLowerCase();
  return donorNormalized ? { donorName, donorNormalized } : null;
}

export class YouTubeChatConnection {
  constructor(userId, apiKey, videoId, onCommand, onStatus, options = {}) {
    this.userId = Number(userId);
    this.apiKey = apiKey;
    this.videoId = videoId;
    this.onCommand = onCommand;
    this.onStatus = onStatus;
    this.stopped = false;
    this.timer = null;
    this.pageToken = '';
    this.fetchImpl = options.fetchImpl || fetch;
    this.streamFactory = options.streamFactory || createYouTubeGrpcStream;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
    this.call = null;
    this.primed = false;
    this.processing = Promise.resolve();
    this.seen = new Map();
  }
  start() { this.connect(); }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.call?.cancel?.();
    this.call = null;
  }
  async request(path, params) {
    const url = new URL(`${API_BASE}/${path}`);
    for (const [key, value] of Object.entries({ ...params, key:this.apiKey })) if (value) url.searchParams.set(key, value);
    const response = await this.fetchImpl(url, { signal:AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `YouTube API HTTP ${response.status}`);
    return data;
  }
  async connect() {
    if (this.stopped) return;
    this.onStatus(this.userId, { state:'connecting', text:'유튜브 라이브 채팅 연결 중' });
    try {
      const video = await this.request('videos', { part:'liveStreamingDetails', id:this.videoId });
      const liveChatId = video.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!liveChatId) throw new Error('진행 중인 라이브 채팅을 찾을 수 없습니다.');
      this.liveChatId = liveChatId;
      this.listen();
    } catch (error) { this.retry(error.message); }
  }
  listen() {
    if (this.stopped) return;
    try {
      const call = this.streamFactory({
        apiKey:this.apiKey,
        liveChatId:this.liveChatId,
        pageToken:this.pageToken,
      });
      this.call = call;
      let finished = false;
      const finish = (message) => {
        if (finished || this.stopped || this.call !== call) return;
        finished = true;
        this.call = null;
        this.retry(message || '유튜브 스트림 연결 종료 · 다시 연결 중');
      };
      call.on('data', response => {
        this.pageToken = response.nextPageToken || this.pageToken;
        this.onStatus(this.userId, { state:'connected', text:'유튜브 라이브 채팅 스트리밍 연결됨' });
        const skipHistory = !this.primed && !this.pageTokenBeforeConnect;
        this.primed = true;
        if (skipHistory) return;
        this.processing = this.processing.then(() => this.processItems(response.items || []))
          .catch(error => console.error('유튜브 채팅 처리 실패:', error.message));
      });
      call.on('error', error => finish(error?.message));
      call.on('end', () => finish());
    } catch (error) { this.retry(error.message); }
  }
  async processItems(items) {
    const now = Date.now();
    for (const [id, seenAt] of this.seen) if (now - seenAt > 10 * 60 * 1000) this.seen.delete(id);
    for (const item of items) {
      if (!['TEXT_MESSAGE_EVENT','textMessageEvent',1].includes(item.snippet?.type)) continue;
      const chatId = String(item.id || '');
      if (!chatId || this.seen.has(chatId)) continue;
      this.seen.set(chatId, now);
      const text = String(item.snippet?.displayMessage || '').trim();
      if (!text) continue;
      await this.onCommand(this.userId, {
        text,
        chatId,
        channelId:String(item.authorDetails?.channelId || ''),
        youtubeName:String(item.authorDetails?.displayName || '').slice(0, 100)
      });
    }
  }
  retry(message) {
    if (this.stopped) return;
    this.onStatus(this.userId, { state:'retrying', text:message || '유튜브 채팅 재연결 중' });
    clearTimeout(this.timer);
    this.pageTokenBeforeConnect = this.pageToken;
    this.timer = setTimeout(() => this.liveChatId ? this.listen() : this.connect(), this.retryDelayMs);
    this.timer.unref?.();
  }
}

export class YouTubeChatManager {
  constructor(onCommand, options = {}) { this.onCommand = onCommand; this.options = options; this.connections = new Map(); this.statuses = new Map(); }
  status(userId) {
    return this.statuses.get(Number(userId)) || { state:'disabled', text:'유튜브 채팅 수신 꺼짐' };
  }
  configure(userId, settings) {
    const id = Number(userId);
    const apiKey = String(settings?.youtubeApiKey || '').trim();
    const videoId = youtubeVideoId(settings?.youtubeVideoId);
    const existing = this.connections.get(id);
    if (existing && existing.apiKey === apiKey && existing.videoId === videoId && settings?.youtubeChatEnabled) return;
    existing?.stop(); this.connections.delete(id);
    if (!settings?.youtubeChatEnabled) return this.setStatus(id, { state:'disabled', text:'유튜브 채팅 수신 꺼짐' });
    if (!apiKey) return this.setStatus(id, { state:'error', text:'YouTube Data API 키를 입력해주세요.' });
    if (!videoId) return this.setStatus(id, { state:'error', text:'유튜브 라이브 주소 또는 영상 ID를 확인해주세요.' });
    const connection = new YouTubeChatConnection(id, apiKey, videoId, this.onCommand, (target, status) => this.setStatus(target, status), this.options);
    this.connections.set(id, connection); connection.start();
  }
  reconnect(userId, settings) { this.connections.get(Number(userId))?.stop(); this.connections.delete(Number(userId)); this.configure(userId, settings); }
  setStatus(userId, status) { this.statuses.set(Number(userId), { ...status, changedAt:new Date().toISOString() }); }
}
