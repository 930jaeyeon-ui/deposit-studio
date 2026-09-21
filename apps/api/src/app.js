import express from 'express';
import { randomBytes } from 'node:crypto';
import { DEFAULT_SETTINGS, normalizeDonation } from '@deposit-studio/shared';
import { activeSession, db } from './db.js';
import { createSession, currentUser, destroySession, hashPassword, requireAuth, requireManager, requireSuper, verifyPassword } from './auth.js';
import { parseNotification, validateRuleInput } from './notification-parser.js';
import { createElevenSpeech, elevenLabsConfigured, listElevenVoices } from './elevenlabs.js';
import { ToonationManager, toonationWidgetKey } from './toonation.js';

export const app = express();
const phoneTestClients = new Map();
const sendSse = (res,event,data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function publishPhoneTest(userId, data) {
  for (const client of phoneTestClients.get(Number(userId)) || []) sendSse(client,'notification',data);
}
const overlayClients = new Set();
const dataChangeClients = new Set();
const ttsRateWindows = new Map();
const overlayPreviewSessions = new Map();
const toonationManager = new ToonationManager(handleToonationDonation);

function allowTtsRequest(key, limit = 60) {
  const now = Date.now();
  const recent = (ttsRateWindows.get(key) || []).filter((time) => now - time < 60000);
  if (recent.length >= limit) return false;
  recent.push(now);
  ttsRateWindows.set(key, recent);
  return true;
}

function sendOverlayEvent(res, event, data, id) {
  if (id != null) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publishDataChange(userId, reason = 'updated') {
  const payload = { reason, changedAt:new Date().toISOString() };
  for (const client of dataChangeClients) {
    if (Number(client.userId) !== Number(userId)) continue;
    sendOverlayEvent(client.res, 'change', payload);
  }
}

function openDataChangeStream(req, res, userId) {
  res.set({
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache, no-transform',
    'Connection':'keep-alive',
    'X-Accel-Buffering':'no'
  });
  res.flushHeaders();
  const client = { res, userId };
  dataChangeClients.add(client);
  sendOverlayEvent(res, 'ready', { connected:true });
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    dataChangeClients.delete(client);
  });
}

function publishOverlayDonation(donation, userId) {
  for (const client of overlayClients) {
    if (Number(client.userId) !== Number(userId)) continue;
    if (client.ready) sendOverlayEvent(client.res, 'donation', donation, donation.id);
    else client.pending.push(donation);
  }
}

function publishOverlayTest(donation, userId) {
  let delivered=0;
  for (const client of overlayClients) {
    if (Number(client.userId) !== Number(userId) || !client.ready) continue;
    sendOverlayEvent(client.res, 'donation', { ...donation, isTest:true });
    delivered+=1;
  }
  return delivered;
}

function publishOverlaySettings(settings, userId) {
  let delivered = 0;
  for (const client of overlayClients) {
    if (Number(client.userId) !== Number(userId) || !client.ready) continue;
    sendOverlayEvent(client.res, 'settings', overlaySettings(settings));
    delivered += 1;
  }
  return delivered;
}

function overlaySettings(settings) {
  const { toonationWidgetUrl: _privateToonationWidgetUrl, ...safe } = settings || {};
  return safe;
}

async function donationWithCrewGrade(donation, userId, settings) {
  if (!settings?.crewGradeEnabled) return { ...donation, crewGradeId:null };
  const total = await db.execute({ sql:`SELECT COALESCE(SUM(d.amount),0) total FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${effectiveDonorName} = ? AND d.status = 'included'`, args:[donation.donorName] });
  const cumulativeAmount=Number(total.rows[0]?.total||0);
  const grade=[...(settings.crewGrades||[])].filter(item=>cumulativeAmount>=Number(item.minAmount||0)&&(item.maxAmount==null||cumulativeAmount<=Number(item.maxAmount))).sort((a,b)=>Number(b.minAmount)-Number(a.minAmount))[0];
  return { ...donation, cumulativeAmount, crewGradeId:grade?.id||null };
}

async function settingsWithCrewPreview(user) {
  const settings=await getUserSettings(user.id);
  const previewDonorName='폴조지';
  const previewDonation=await donationWithCrewGrade({ donorName:previewDonorName, amount:50000 },user.id,settings);
  return { ...settings, previewCrewGradeId:previewDonation.crewGradeId, previewDonorName, previewCumulativeAmount:previewDonation.cumulativeAmount||0 };
}
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.WEB_ORIGIN || req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '75mb' }));
app.use((req, res, next) => {
  if (req.method !== 'POST' || req.path !== '/api/notifications') return next();
  const startedAt = Date.now();
  let responseBody = null;
  const originalJson = res.json.bind(res);
  res.json = body => { responseBody = body; return originalJson(body); };
  res.on('finish', () => {
    const headers = { ...req.headers };
    for (const key of ['authorization','x-api-key','cookie']) if (headers[key]) headers[key] = '[REDACTED]';
    const serialize = (value, limit) => {
      try { return JSON.stringify(value ?? null).slice(0, limit); }
      catch { return JSON.stringify({ error:'직렬화할 수 없는 값입니다.' }); }
    };
    db.execute({ sql:`INSERT INTO api_request_logs
      (method, path, request_headers, request_body, response_status, response_body, remote_address, recipient_user_id, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, args:[req.method,req.originalUrl,serialize(headers,10000),serialize(req.body,20000),res.statusCode,serialize(responseBody,20000),String(req.ip||req.socket.remoteAddress||'').slice(0,100),req.notificationUserId||null,Date.now()-startedAt] })
      .then(() => db.execute(`DELETE FROM api_request_logs WHERE id NOT IN (SELECT id FROM api_request_logs ORDER BY id DESC LIMIT 1000)`))
      .catch(error => console.error('API 로그 저장 실패:', error.message));
    if (req.notificationUserId) publishPhoneTest(req.notificationUserId, {
      receivedAt:new Date().toISOString(),
      request:{ packageName:req.body?.packageName, title:req.body?.title, content:req.body?.content },
      response:{ status:res.statusCode, body:responseBody },
      durationMs:Date.now()-startedAt
    });
  });
  next();
});
app.get('/api/health', (_req, res) => res.json({ ok:true, ttsConfigured:elevenLabsConfigured() }));

app.get('/api/tts/voices', requireAuth, async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!elevenLabsConfigured()) return res.json({ configured:false, voices:[] });
  try {
    res.json({ configured:true, voices:await listElevenVoices() });
  } catch (error) {
    res.status(error.status || 502).json({ error:error.message });
  }
});

app.post('/api/tts/preview', requireAuth, async (req, res) => {
  try {
    if (!allowTtsRequest(`preview:${req.user.id}`, 20)) {
      return res.status(429).json({ error:'미리듣기 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    const audio = await createElevenSpeech({
      text:req.body?.text,
      voiceId:req.body?.voiceId,
      model:req.body?.model,
      rate:req.body?.rate,
    });
    res.set({ 'Content-Type':'audio/mpeg', 'Cache-Control':'no-store' });
    res.send(audio);
  } catch (error) {
    res.status(error.status || 502).json({ error:error.message });
  }
});

app.post('/api/overlay/:token/tts', async (req, res) => {
  try {
    const user = await getObsUser(req.params.token);
    if (!user) return res.status(404).json({ error:'유효하지 않은 OBS 주소입니다.' });
    if (!allowTtsRequest(`overlay:${user.id}`)) {
      return res.status(429).json({ error:'TTS 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    const settings = await getUserSettings(user.id);
    const requestedVoiceId = String(req.body?.voiceId || '');
    const allowedVoiceIds = new Set([
      settings.ttsElevenVoiceId,
      ...(settings.amountTiers || []).map((tier) => tier.ttsElevenVoiceId),
    ].filter(Boolean));
    if (settings.ttsProvider !== 'elevenlabs' && !(settings.amountTiers || []).some((tier) => tier.ttsProvider === 'elevenlabs')) {
      return res.status(400).json({ error:'ElevenLabs TTS가 선택되지 않았습니다.' });
    }
    if (!allowedVoiceIds.has(requestedVoiceId)) {
      return res.status(400).json({ error:'저장되지 않은 TTS 음성입니다.' });
    }
    const audio = await createElevenSpeech({
      text:req.body?.text,
      voiceId:requestedVoiceId,
      model:req.body?.model,
      rate:req.body?.rate,
    });
    res.set({ 'Content-Type':'audio/mpeg', 'Cache-Control':'no-store' });
    res.send(audio);
  } catch (error) {
    res.status(error.status || 502).json({ error:error.message });
  }
});

const effectiveDonorName = `COALESCE(NULLIF(d.donor_override_name, ''), NULLIF(a.canonical_name, ''), d.donor_name)`;
const MEMBER_INITIAL_PASSWORD = 'Init1234!!';

async function getUserSettings(userId) {
  const result = await db.execute({ sql:'SELECT s.value, u.role FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ? LIMIT 1', args:[userId] });
  if (!result.rows.length) {
    return cleanSettings(DEFAULT_SETTINGS);
  }
  if (!result.rows[0].value) await db.execute({ sql:'INSERT INTO user_settings (user_id, value) VALUES (?, ?)', args:[userId,JSON.stringify(DEFAULT_SETTINGS)] });
  const settings=cleanSettings(result.rows[0].value?JSON.parse(result.rows[0].value):DEFAULT_SETTINGS);
  if(result.rows[0].role!=='super') settings.crewGrades=await getSharedCrewGrades();
  return settings;
}

async function getSharedCrewGrades() {
  const result=await db.execute(`SELECT s.value FROM users u JOIN user_settings s ON s.user_id = u.id WHERE u.role = 'super' AND u.is_active = 1 ORDER BY u.id LIMIT 1`);
  if(!result.rows.length)return [];
  try{return cleanSettings(JSON.parse(result.rows[0].value)).crewGrades;}catch{return [];}
}

async function getObsUser(token) {
  const value = String(token || '').trim();
  if (!/^[a-f0-9]{48}$/.test(value)) return null;
  const result = await db.execute({ sql:'SELECT id, login_id loginId, display_name displayName FROM users WHERE obs_token = ? AND is_active = 1 LIMIT 1', args:[value] });
  return result.rows[0] || null;
}

function cleanSettings(input) {
  const settings = { ...DEFAULT_SETTINGS, ...input };
  settings.minimumDonationAmount = Math.max(0, Math.min(100000000, Math.floor(Number(settings.minimumDonationAmount) || 0)));
  settings.alertMinimumAmount = Math.max(0, Math.min(100000000, Math.floor(Number(settings.alertMinimumAmount) || 0)));
  settings.toonationEnabled = Boolean(settings.toonationEnabled);
  settings.toonationWidgetUrl = String(settings.toonationWidgetUrl || '').trim().slice(0,1000);
  const legacyToonationMode = settings.toonationUseOwnAlert ? 'custom' : 'official';
  settings.toonationAlertMode = ['official','custom','custom-original-audio'].includes(settings.toonationAlertMode) ? settings.toonationAlertMode : legacyToonationMode;
  settings.toonationUseOwnAlert = settings.toonationAlertMode !== 'official';
  settings.durationMs = Math.max(1000, Math.min(30000, Math.floor(Number(settings.durationMs) || 5000)));
  settings.fontSize = Math.max(20, Math.min(160, Math.floor(Number(settings.fontSize) || 54)));
  settings.fontWeight = Math.max(100, Math.min(900, Math.floor(Number(settings.fontWeight) || 800)));
  settings.outlineWidth = Math.max(0, Math.min(12, Number(settings.outlineWidth) || 0));
  settings.lineHeight = Math.max(0.8, Math.min(2.5, Number(settings.lineHeight) || 1.35));
  settings.letterSpacing = Math.max(-5, Math.min(30, Number(settings.letterSpacing) || 0));
  settings.backgroundOpacity = Math.max(0, Math.min(1, Number(settings.backgroundOpacity) || 0));
  settings.backgroundPadding = Math.max(0, Math.min(100, Number(settings.backgroundPadding) || 0));
  settings.backgroundRadius = Math.max(0, Math.min(100, Number(settings.backgroundRadius) || 0));
  settings.soundVolume = Math.max(0, Math.min(100, Number(settings.soundVolume) || 0));
  settings.messageTemplate = String(settings.messageTemplate || DEFAULT_SETTINGS.messageTemplate).slice(0,300);
  settings.fontFamily = String(settings.fontFamily || DEFAULT_SETTINGS.fontFamily).slice(0,120);
  settings.customFontFamily = String(settings.customFontFamily || '').slice(0,100);
  settings.textAlign = ['left','center','right'].includes(settings.textAlign) ? settings.textAlign : 'center';
  settings.nameColorEnabled=Boolean(settings.nameColorEnabled);
  settings.amountColorEnabled=Boolean(settings.amountColorEnabled);
  settings.nameColor=String(settings.nameColor||DEFAULT_SETTINGS.nameColor).slice(0,20);
  settings.amountColor=String(settings.amountColor||DEFAULT_SETTINGS.amountColor).slice(0,20);
  settings.suffixStyleEnabled=Boolean(settings.suffixStyleEnabled);
  settings.suffixColor=String(settings.suffixColor||DEFAULT_SETTINGS.suffixColor).slice(0,20);
  settings.suffixFontFamily=String(settings.suffixFontFamily||DEFAULT_SETTINGS.suffixFontFamily).slice(0,120);
  settings.animation = ['fade','zoom','slide-up','slide-down','slide-left','slide-right','bounce','flip','pulse','shake'].includes(settings.animation) ? settings.animation : 'zoom';
  settings.exitAnimation = ['fade-out','zoom-out','slide-down-out','slide-up-out'].includes(settings.exitAnimation) ? settings.exitAnimation : 'fade-out';
  settings.soundPreset = ['coin','chime','pop','fanfare','bell','sparkle','success','drum','laser','magic','custom','none'].includes(settings.soundPreset) || String(settings.soundPreset).startsWith('library:') ? settings.soundPreset : 'coin';
  settings.backgroundEnabled = Boolean(settings.backgroundEnabled);
  settings.backgroundImageData=String(settings.backgroundImageData||'').slice(0,7000000);
  if(settings.backgroundImageData&&!settings.backgroundImageData.startsWith('data:image/'))settings.backgroundImageData='';
  settings.backgroundImageName=String(settings.backgroundImageName||'').slice(0,100);
  settings.outlineEnabled = settings.outlineEnabled !== false;
  settings.textShadow = Boolean(settings.textShadow);
  settings.soundEnabled = Boolean(settings.soundEnabled);
  settings.ttsEnabled = Boolean(settings.ttsEnabled);
  settings.ttsProvider = settings.ttsProvider === 'elevenlabs' ? 'elevenlabs' : 'browser';
  settings.ttsVoiceURI = String(settings.ttsVoiceURI || '').slice(0,300);
  settings.ttsElevenVoiceId = String(settings.ttsElevenVoiceId || '').slice(0,80);
  settings.ttsElevenVoiceName = String(settings.ttsElevenVoiceName || '').slice(0,120);
  settings.ttsModel = settings.ttsModel === 'eleven_multilingual_v2' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5';
  delete settings.ttsAzureVoice;
  delete settings.previewCrewGradeId;
  delete settings.previewDonorName;
  delete settings.previewCumulativeAmount;
  settings.ttsRate = Math.max(0.5, Math.min(2, Number(settings.ttsRate) || 1));
  settings.ttsPitch = Math.max(0, Math.min(2, Number.isFinite(Number(settings.ttsPitch)) ? Number(settings.ttsPitch) : 1));
  settings.ttsVolume = Math.max(0, Math.min(100, Number.isFinite(Number(settings.ttsVolume)) ? Number(settings.ttsVolume) : DEFAULT_SETTINGS.ttsVolume));
  settings.crewGradeEnabled = Boolean(settings.crewGradeEnabled);
  settings.crewGradeDisplayMode=settings.crewGradeDisplayMode==='text'?'text':'image';
  settings.crewGradeTextColor=String(settings.crewGradeTextColor||DEFAULT_SETTINGS.crewGradeTextColor).slice(0,20);
  settings.crewGradeTextFontFamily=String(settings.crewGradeTextFontFamily||DEFAULT_SETTINGS.crewGradeTextFontFamily).slice(0,120);
  settings.crewGradeTextSize=Math.max(16,Math.min(160,Number(settings.crewGradeTextSize)||54));
  settings.crewGradeMinimumAmount = Math.max(0, Math.min(1000000000, Number(settings.crewGradeMinimumAmount) || DEFAULT_SETTINGS.crewGradeMinimumAmount));
  settings.crewGradeImageData = String(settings.crewGradeImageData || '').slice(0,1400000);
  if (settings.crewGradeImageData && !settings.crewGradeImageData.startsWith('data:image/')) settings.crewGradeImageData = '';
  settings.crewGradeImageName = String(settings.crewGradeImageName || '').slice(0,100);
  const requestedGradeImageSize=Number(settings.crewGradeImageSize)||DEFAULT_SETTINGS.crewGradeImageSize;
  settings.crewGradeImageSize = Math.max(80, Math.min(400, requestedGradeImageSize <= 180 ? DEFAULT_SETTINGS.crewGradeImageSize : requestedGradeImageSize));
  settings.crewGrades = Array.isArray(settings.crewGrades) ? settings.crewGrades.slice(0,20).map((grade,index)=>({id:String(grade.id||`grade-${index}`).slice(0,50),name:String(grade.name||`${index+1}등급`).slice(0,30),minAmount:Math.max(0,Math.min(1000000000,Number(grade.minAmount)||0)),maxAmount:grade.maxAmount==null||grade.maxAmount===''?null:Math.max(0,Math.min(1000000000,Number(grade.maxAmount)||0)),imageName:String(grade.imageName||'').slice(0,100),imageData:String(grade.imageData||'').slice(0,7000000)})).filter(grade=>!grade.imageData||grade.imageData.startsWith('data:image/')) : [];
  settings.customSoundData = String(settings.customSoundData || '').slice(0,7000000);
  settings.customSoundName = String(settings.customSoundName || '').slice(0,100);
  settings.soundLibrary = Array.isArray(settings.soundLibrary) ? settings.soundLibrary.slice(0,10).map((sound,index)=>({id:String(sound.id || `sound-${index}`).slice(0,50),name:String(sound.name || `내 음원 ${index+1}`).slice(0,100),data:String(sound.data || '').slice(0,7000000)})).filter(sound=>sound.data.startsWith('data:audio/')) : [];
  settings.amountTiers = Array.isArray(settings.amountTiers) ? settings.amountTiers.slice(0,12).map((tier,index)=>({
    id:String(tier.id || `tier-${index}`).slice(0,40), name:String(tier.name || `${index+1}구간`).slice(0,30),
    minAmount:Math.max(0,Math.min(100000000,Number(tier.minAmount)||0)), maxAmount:tier.maxAmount==null||tier.maxAmount===''?null:Math.max(0,Math.min(100000000,Number(tier.maxAmount)||0)),
    enabled:tier.enabled !== false,
    messageMode:tier.messageMode === 'custom' ? 'custom' : 'inherit', messageTemplate:String(tier.messageTemplate || '').slice(0,300),
    textMode:tier.textMode === 'custom' ? 'custom' : 'inherit', fontFamily:String(tier.fontFamily || settings.fontFamily).slice(0,120), fontSize:Math.max(20,Math.min(160,Number(tier.fontSize)||settings.fontSize)), fontWeight:Math.max(100,Math.min(900,Number(tier.fontWeight)||settings.fontWeight)), textColor:String(tier.textColor || settings.textColor).slice(0,20), outlineColor:String(tier.outlineColor || settings.outlineColor).slice(0,20), outlineWidth:Math.max(0,Math.min(12,Number(tier.outlineWidth)||0)),
    effectMode:tier.effectMode === 'custom' ? 'custom' : 'inherit', animation:String(tier.animation || settings.animation).slice(0,30), exitAnimation:String(tier.exitAnimation || settings.exitAnimation).slice(0,30), durationMs:Math.max(1000,Math.min(30000,Number(tier.durationMs)||settings.durationMs)),
    soundMode:tier.soundMode === 'custom' ? 'custom' : 'inherit', soundPreset:String(tier.soundPreset || settings.soundPreset).slice(0,80), soundVolume:Math.max(0,Math.min(100,Number.isFinite(Number(tier.soundVolume)) ? Number(tier.soundVolume) : settings.soundVolume)), customSoundName:String(tier.customSoundName || '').slice(0,100), customSoundData:String(tier.customSoundData || '').slice(0,7000000),
    ttsMode:tier.ttsMode === 'custom' ? 'custom' : 'inherit', ttsEnabled:tier.ttsEnabled !== false, ttsProvider:tier.ttsProvider === 'elevenlabs' ? 'elevenlabs' : 'browser', ttsVoiceURI:String(tier.ttsVoiceURI || settings.ttsVoiceURI || '').slice(0,300), ttsElevenVoiceId:String(tier.ttsElevenVoiceId || settings.ttsElevenVoiceId || '').slice(0,80), ttsElevenVoiceName:String(tier.ttsElevenVoiceName || settings.ttsElevenVoiceName || '').slice(0,120), ttsModel:tier.ttsModel === 'eleven_multilingual_v2' ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5', ttsRate:Math.max(.5,Math.min(2,Number(tier.ttsRate)||settings.ttsRate)), ttsPitch:Math.max(0,Math.min(2,Number.isFinite(Number(tier.ttsPitch)) ? Number(tier.ttsPitch) : settings.ttsPitch)), ttsVolume:Math.max(0,Math.min(100,Number.isFinite(Number(tier.ttsVolume))?Number(tier.ttsVolume):settings.ttsVolume))
  })) : [];
  settings.rankingLimit = Number(settings.rankingLimit) === 1 ? 1 : 3;
  settings.rankingFontFamily = String(settings.rankingFontFamily || DEFAULT_SETTINGS.rankingFontFamily).slice(0,120);
  settings.rankingFontSize = Math.max(16, Math.min(72, Math.floor(Number(settings.rankingFontSize) || DEFAULT_SETTINGS.rankingFontSize)));
  settings.rankingFontWeight = Math.max(100, Math.min(900, Math.floor(Number(settings.rankingFontWeight) || 700)));
  settings.rankingUseLineHeight = Boolean(settings.rankingUseLineHeight);
  settings.rankingLineHeight = Math.max(.8, Math.min(2, Number(settings.rankingLineHeight) || 1.2));
  settings.rankingLetterSpacing = Math.max(-5, Math.min(20, Number(settings.rankingLetterSpacing) || 0));
  settings.rankingRowGap = Math.max(0, Math.min(40, Math.floor(Number(settings.rankingRowGap) || 0)));
  settings.rankingColumnGap = Math.max(0, Math.min(80, Number(settings.rankingColumnGap) || 0));
  settings.rankingNameAlign = ['left','center','right'].includes(settings.rankingNameAlign) ? settings.rankingNameAlign : 'left';
  settings.rankingAmountAlign = ['left','center','right'].includes(settings.rankingAmountAlign) ? settings.rankingAmountAlign : 'right';
  settings.rankingRowAlign = ['spread','left','center','right'].includes(settings.rankingRowAlign) ? settings.rankingRowAlign : 'spread';
  settings.rankingTheme = ['midnight','clean','neon','gold','rose','ocean','forest','lavender','mono','transparent','custom'].includes(settings.rankingTheme) ? settings.rankingTheme : DEFAULT_SETTINGS.rankingTheme;
  settings.rankingBackgroundEnabled=Boolean(settings.rankingBackgroundEnabled);
  for (const key of ['rankingCustomBackground','rankingCustomBorder','rankingCustomRowBackground']) settings[key]=String(settings[key]||DEFAULT_SETTINGS[key]).slice(0,20);
  settings.rankingCustomRadius=Math.max(0,Math.min(60,Number(settings.rankingCustomRadius)||0));
  settings.rankingCustomMarker=['circle','square','pill','plain'].includes(settings.rankingCustomMarker)?settings.rankingCustomMarker:'circle';
  settings.rankingNameSuffix = String(settings.rankingNameSuffix || '').slice(0,12);
  settings.rankingAmountSuffix = String(settings.rankingAmountSuffix || '').slice(0,12);
  settings.rankingShowTitle = settings.rankingShowTitle !== false;
  settings.rankingTitleSize = Math.max(14,Math.min(72,Number(settings.rankingTitleSize)||24));
  settings.rankingTitleAlign = ['left','center','right'].includes(settings.rankingTitleAlign)?settings.rankingTitleAlign:'left';
  for (const key of ['rankingTitleColor','rankingNameColor','rankingAmountColor']) settings[key]=String(settings[key]||DEFAULT_SETTINGS[key]).slice(0,20);
  settings.rankingColumns = Math.max(1,Math.min(4,Math.floor(Number(settings.rankingColumns)||1)));
  settings.rankingRowsPerColumn = Math.max(1,Math.min(20,Math.floor(Number(settings.rankingRowsPerColumn)||10)));
  settings.rankingAnimation = ['none','fade','slide-up','slide-left','zoom','stagger'].includes(settings.rankingAnimation)?settings.rankingAnimation:'fade';
  settings.rankingRankHighlightEnabled = settings.rankingRankHighlightEnabled !== false;
  settings.rankingRankStyles = Array.from({length:4},(_,index)=>{const source=Array.isArray(settings.rankingRankStyles)?settings.rankingRankStyles[index]||{}:{};const fallback=DEFAULT_SETTINGS.rankingRankStyles[index];return {color:String(source.color||fallback.color).slice(0,20),badge:String(source.badge||fallback.badge).slice(0,20),size:Math.max(70,Math.min(160,Number(source.size)||fallback.size)),weight:Math.max(100,Math.min(900,Number(source.weight)||fallback.weight))};});
  settings.rankingShowRank = Boolean(settings.rankingShowRank);
  settings.rankingShowCount = Boolean(settings.rankingShowCount);
  settings.rankingTitle = String(settings.rankingTitle || DEFAULT_SETTINGS.rankingTitle).trim().slice(0, 40);
  return settings;
}

async function handleToonationDonation(userId, input) {
  const settings = await getUserSettings(userId);
  if (!settings.toonationEnabled || input.amount < Number(settings.minimumDonationAmount || 0)) return;
  const session = await activeSession();
  const inserted = await db.execute({
    sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank) VALUES (?, ?, ?, ?, 'toonation')`,
    args:[session.id,userId,input.donorName,input.amount]
  });
  const saved = await db.execute({ sql:`SELECT id, donor_name donorName, amount, bank, datetime(received_at, '+9 hours') receivedAt FROM donations WHERE id = ?`, args:[inserted.lastInsertRowid] });
  const donation = await donationWithCrewGrade({ ...saved.rows[0], message:input.message, toonationGrade:input.grade }, userId, settings);
  if (settings.toonationUseOwnAlert) publishOverlayDonation(donation, userId);
  publishDataChange(userId, 'toonation-created');
}

export async function startToonationConnections() {
  const users = await db.execute(`SELECT id FROM users WHERE is_active = 1`);
  for (const user of users.rows) toonationManager.configure(user.id, await getUserSettings(user.id));
}

app.post('/api/auth/login', async (req, res) => {
  const loginId = String(req.body?.loginId || '').trim();
  const password = String(req.body?.password || '');
  const result = await db.execute({ sql:`SELECT id, login_id loginId, display_name displayName, role, password_hash passwordHash, avatar_path avatar, must_change_password mustChangePassword FROM users WHERE login_id = ? COLLATE NOCASE AND is_active = 1 LIMIT 1`, args:[loginId] });
  const user = result.rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error:'아이디 또는 비밀번호를 확인해주세요.' });
  await createSession(res, user.id, req);
  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

app.get('/api/auth/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error:'로그인이 필요합니다.' });
  res.json(user);
});

app.get('/api/my/phone-test/events', requireAuth, async (req, res) => {
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache, no-transform', Connection:'keep-alive', 'X-Accel-Buffering':'no' });
  res.flushHeaders();
  const userId = Number(req.user.id);
  const clients = phoneTestClients.get(userId) || new Set();
  clients.add(res);
  phoneTestClients.set(userId, clients);
  sendSse(res,'ready',{ connected:true });
  const latest = await db.execute({ sql:`SELECT request_body requestBody, response_status responseStatus, response_body responseBody, duration_ms durationMs, created_at receivedAt FROM api_request_logs WHERE recipient_user_id = ? ORDER BY id DESC LIMIT 1`, args:[userId] });
  if (latest.rows[0]) {
    const row=latest.rows[0];
    const parse=value=>{try{return JSON.parse(value);}catch{return value;}};
    sendSse(res,'snapshot',{ receivedAt:row.receivedAt, request:parse(row.requestBody), response:{status:Number(row.responseStatus),body:parse(row.responseBody)}, durationMs:Number(row.durationMs) });
  }
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'),15000);
  res.on('close',()=>{ clearInterval(heartbeat); clients.delete(res); if (!clients.size) phoneTestClients.delete(userId); });
});

app.post('/api/auth/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok:true });
});

app.put('/api/profile', requireAuth, async (req, res) => {
  const displayName = String(req.body?.displayName || '').trim();
  const avatar = req.body?.avatar == null ? null : String(req.body.avatar);
  if (displayName.length < 1 || displayName.length > 20) return res.status(400).json({ error:'표시 이름은 1~20자로 입력해주세요.' });
  if (avatar && !(/^\/avatars\/[a-zA-Z0-9._-]+$/.test(avatar) || /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(avatar))) {
    return res.status(400).json({ error:'지원하지 않는 프로필 이미지 형식입니다.' });
  }
  if (avatar && avatar.length > 1_500_000) return res.status(400).json({ error:'프로필 이미지는 1MB 이하로 선택해주세요.' });
  await db.execute({ sql:'UPDATE users SET display_name = ?, avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args:[displayName,avatar,req.user.id] });
  const user = await currentUser(req);
  res.json(user);
});

app.put('/api/profile/password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const result = await db.execute({ sql:'SELECT password_hash passwordHash FROM users WHERE id = ?', args:[req.user.id] });
  if (!verifyPassword(currentPassword, result.rows[0]?.passwordHash)) return res.status(400).json({ error:'현재 비밀번호가 올바르지 않습니다.' });
  if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    return res.status(400).json({ error:'새 비밀번호는 8자 이상이며 영문, 숫자, 특수문자를 포함해야 합니다.' });
  }
  if (currentPassword === newPassword) return res.status(400).json({ error:'현재 비밀번호와 다른 비밀번호를 입력해주세요.' });
  await db.execute({ sql:'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args:[hashPassword(newPassword),req.user.id] });
  await db.execute({ sql:'DELETE FROM web_sessions WHERE user_id = ?', args:[req.user.id] });
  await createSession(res, req.user.id, req);
  res.json({ ok:true });
});

app.get('/api/users', requireAuth, requireManager, async (req, res) => {
  const superFilter = req.user.role === 'super' ? '' : `WHERE role <> 'super'`;
  const result = await db.execute(`SELECT id, login_id loginId, display_name displayName, role, avatar_path avatar, is_active isActive FROM users ${superFilter} ORDER BY CASE role WHEN 'super' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, id`);
  res.json(result.rows);
});

app.post('/api/users', requireAuth, requireManager, async (req, res) => {
  const loginId = String(req.body?.loginId || '').trim().toLowerCase();
  const displayName = String(req.body?.displayName || '').trim();
  const role = ['admin','member'].includes(req.body?.role) ? req.body.role : 'member';
  if (!/^[a-z0-9._-]{3,30}$/.test(loginId)) return res.status(400).json({ error:'아이디는 영문 소문자, 숫자, 점, 밑줄, 하이픈으로 3~30자 입력해주세요.' });
  if (displayName.length < 1 || displayName.length > 20) return res.status(400).json({ error:'이름은 1~20자로 입력해주세요.' });
  try {
    const created = await db.execute({
      sql:'INSERT INTO users (login_id, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)',
      args:[loginId,displayName,role,hashPassword(MEMBER_INITIAL_PASSWORD)]
    });
    const result = await db.execute({ sql:'SELECT id, login_id loginId, display_name displayName, role, avatar_path avatar, is_active isActive FROM users WHERE id = ?', args:[created.lastInsertRowid] });
    res.status(201).json({ ...result.rows[0], temporaryPassword:MEMBER_INITIAL_PASSWORD });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error:'이미 사용 중인 아이디입니다.' });
    throw error;
  }
});

app.put('/api/users/:id/status', requireAuth, requireManager, async (req, res) => {
  const targetId = Number(req.params.id);
  const active = Boolean(req.body?.active);
  const result = await db.execute({ sql:'SELECT id, role FROM users WHERE id = ?', args:[targetId] });
  const target = result.rows[0];
  if (!target) return res.status(404).json({ error:'계정을 찾을 수 없습니다.' });
  if (target.id === req.user.id) return res.status(400).json({ error:'자신의 계정은 중지할 수 없습니다.' });
  if (target.role === 'super') return res.status(403).json({ error:'이 계정은 변경할 수 없습니다.' });
  await db.execute({ sql:'UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args:[active?1:0,targetId] });
  if (!active) await db.execute({ sql:'DELETE FROM web_sessions WHERE user_id = ?', args:[targetId] });
  res.json({ ok:true, active });
});

app.post('/api/users/:id/reset-password', requireAuth, requireManager, async (req, res) => {
  const targetId = Number(req.params.id);
  const result = await db.execute({ sql:'SELECT id, role FROM users WHERE id = ?', args:[targetId] });
  const target = result.rows[0];
  if (!target) return res.status(404).json({ error:'계정을 찾을 수 없습니다.' });
  if (target.id === req.user.id) return res.status(400).json({ error:'본인 비밀번호는 상단 프로필 메뉴에서 변경해주세요.' });
  if (target.role === 'super') return res.status(403).json({ error:'이 계정은 변경할 수 없습니다.' });
  await db.execute({ sql:'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args:[hashPassword(MEMBER_INITIAL_PASSWORD),targetId] });
  await db.execute({ sql:'DELETE FROM web_sessions WHERE user_id = ?', args:[targetId] });
  res.json({ ok:true, temporaryPassword:MEMBER_INITIAL_PASSWORD });
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
  const session = await activeSession();
  const [donations, summary, savedSettings] = await Promise.all([
    db.execute({ sql:`SELECT d.id, ${effectiveDonorName} donorName, d.amount, d.bank, datetime(d.received_at, '+9 hours') receivedAt FROM donations d JOIN users u ON u.id = d.recipient_user_id LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.session_id = ? AND d.status = 'included' AND u.role <> 'super' ORDER BY d.id DESC LIMIT 100`, args:[session.id] }),
    db.execute({ sql:`SELECT COALESCE(SUM(d.amount),0) totalAmount, COUNT(*) donationCount, COUNT(DISTINCT ${effectiveDonorName}) donorCount FROM donations d JOIN users u ON u.id = d.recipient_user_id LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.session_id = ? AND d.status = 'included' AND u.role <> 'super'`, args:[session.id] }),
    getUserSettings(req.user.id)
  ]);
  res.json({ session, donations:donations.rows, summary:summary.rows[0], settings:savedSettings });
});

app.get('/api/dashboard/donors', requireAuth, async (req, res) => {
  const session = await activeSession();
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const query = String(req.query.query || '').trim().slice(0, 40);
  const donorSource = `FROM donations d JOIN users u ON u.id = d.recipient_user_id LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.session_id = ? AND d.status = 'included' AND u.role <> 'super' GROUP BY ${effectiveDonorName}`;
  const [items, total, match] = await Promise.all([
    db.execute({ sql:`SELECT ${effectiveDonorName} donorName, SUM(d.amount) amount, COUNT(*) count ${donorSource} ORDER BY amount DESC, donorName LIMIT ? OFFSET ?`, args:[session.id,limit,offset] }),
    db.execute({ sql:`SELECT COUNT(*) total FROM (SELECT 1 ${donorSource})`, args:[session.id] }),
    query ? db.execute({ sql:`SELECT donorName, amount, count, donorIndex FROM (SELECT ${effectiveDonorName} donorName, SUM(d.amount) amount, COUNT(*) count, ROW_NUMBER() OVER (ORDER BY SUM(d.amount) DESC, ${effectiveDonorName}) - 1 donorIndex ${donorSource}) WHERE instr(lower(donorName), lower(?)) > 0 ORDER BY donorIndex LIMIT 1`, args:[session.id,query] }) : Promise.resolve({ rows:[] })
  ]);
  const totalCount = Number(total.rows[0]?.total || 0);
  res.json({ items:items.rows, total:totalCount, offset, limit, hasMore:offset + items.rows.length < totalCount, match:match.rows[0] || null });
});

app.get('/api/my/donors', requireAuth, async (req, res) => {
  const period = ['today','7d','30d','month','all'].includes(req.query.period) ? req.query.period : 'month';
  const filters = {
    today: `strftime('%Y-%m-%d', datetime(d.received_at, '+9 hours')) = strftime('%Y-%m-%d', datetime('now', '+9 hours'))`,
    '7d': `datetime(d.received_at, '+9 hours') >= datetime('now', '+9 hours', 'start of day', '-6 days')`,
    '30d': `datetime(d.received_at, '+9 hours') >= datetime('now', '+9 hours', 'start of day', '-29 days')`,
    month: `strftime('%Y-%m', datetime(d.received_at, '+9 hours')) = strftime('%Y-%m', datetime('now', '+9 hours'))`,
    all: '1 = 1'
  };
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const query = String(req.query.query || '').trim().slice(0, 40);
  const donorSource = `FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.recipient_user_id = ? AND d.status = 'included' AND ${filters[period]} GROUP BY ${effectiveDonorName}`;
  const [items, total, match] = await Promise.all([
    db.execute({ sql:`SELECT ${effectiveDonorName} donorName, SUM(d.amount) amount, COUNT(*) count ${donorSource} ORDER BY amount DESC, donorName LIMIT ? OFFSET ?`, args:[req.user.id,limit,offset] }),
    db.execute({ sql:`SELECT COUNT(*) total FROM (SELECT 1 ${donorSource})`, args:[req.user.id] }),
    query ? db.execute({ sql:`SELECT donorName, amount, count, donorIndex FROM (SELECT ${effectiveDonorName} donorName, SUM(d.amount) amount, COUNT(*) count, ROW_NUMBER() OVER (ORDER BY SUM(d.amount) DESC, ${effectiveDonorName}) - 1 donorIndex ${donorSource}) WHERE instr(lower(donorName), lower(?)) > 0 ORDER BY donorIndex LIMIT 1`, args:[req.user.id,query] }) : Promise.resolve({ rows:[] })
  ]);
  const totalCount = Number(total.rows[0]?.total || 0);
  res.json({ items:items.rows, total:totalCount, offset, limit, hasMore:offset + items.rows.length < totalCount, match:match.rows[0] || null });
});

app.get('/api/my/analytics', requireAuth, async (req, res) => {
  const period = ['today','7d','30d','month','all'].includes(req.query.period) ? req.query.period : 'month';
  const filters = {
    today: `strftime('%Y-%m-%d', datetime(d.received_at, '+9 hours')) = strftime('%Y-%m-%d', datetime('now', '+9 hours'))`,
    '7d': `datetime(d.received_at, '+9 hours') >= datetime('now', '+9 hours', 'start of day', '-6 days')`,
    '30d': `datetime(d.received_at, '+9 hours') >= datetime('now', '+9 hours', 'start of day', '-29 days')`,
    month: `strftime('%Y-%m', datetime(d.received_at, '+9 hours')) = strftime('%Y-%m', datetime('now', '+9 hours'))`,
    all: '1 = 1'
  };
  const where = `d.recipient_user_id = ? AND d.status = 'included' AND ${filters[period]}`;
  const execute = sql => db.execute({ sql, args:[req.user.id] });
  const [summary, donors, weekdays, days, months, hours, largestDonation] = await Promise.all([
    execute(`SELECT COALESCE(SUM(d.amount), 0) totalAmount, COUNT(*) donationCount, COUNT(DISTINCT ${effectiveDonorName}) donorCount, COALESCE(AVG(d.amount), 0) averageAmount, COALESCE(MAX(d.amount), 0) largestAmount FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${where}`),
    execute(`SELECT ${effectiveDonorName} donorName, SUM(d.amount) amount, COUNT(*) count, datetime(MAX(d.received_at), '+9 hours') lastReceivedAt FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${where} GROUP BY ${effectiveDonorName} ORDER BY amount DESC, donorName LIMIT 100`),
    execute(`SELECT CAST(strftime('%w', datetime(d.received_at, '+9 hours')) AS INTEGER) weekday, SUM(d.amount) amount, COUNT(*) count FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${where} GROUP BY weekday ORDER BY weekday`),
    period === 'all'
      ? Promise.resolve({ rows:[] })
      : execute(`SELECT strftime('%Y-%m-%d', datetime(d.received_at, '+9 hours')) day, SUM(d.amount) amount, COUNT(*) count FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${where} GROUP BY day ORDER BY day`),
    execute(`SELECT strftime('%Y-%m', datetime(d.received_at, '+9 hours')) month, SUM(d.amount) amount, COUNT(*) count, COUNT(DISTINCT ${effectiveDonorName}) donorCount FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.recipient_user_id = ? AND d.status = 'included' AND datetime(d.received_at, '+9 hours') >= datetime('now', '+9 hours', 'start of month', '-11 months') GROUP BY month ORDER BY month`),
    period === 'today'
      ? execute(`SELECT CAST(strftime('%H', datetime(d.received_at, '+9 hours')) AS INTEGER) hour, SUM(d.amount) amount, COUNT(*) count FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${where} GROUP BY hour ORDER BY hour`)
      : Promise.resolve({ rows:[] }),
    period === 'today'
      ? execute(`SELECT ${effectiveDonorName} donorName, d.amount, datetime(d.received_at, '+9 hours') receivedAt FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${where} ORDER BY d.amount DESC, d.id DESC LIMIT 1`)
      : Promise.resolve({ rows:[] })
  ]);
  res.json({ period, summary:summary.rows[0], donors:donors.rows, weekdays:weekdays.rows, days:days.rows, months:months.rows, hours:hours.rows, largestDonation:largestDonation.rows[0] || null });
});

app.get('/api/my/deposits', requireAuth, async (req, res) => {
  const range = ['today','yesterday','7d','30d','month','custom','all','session'].includes(req.query.range) ? req.query.range : 'today';
  const query = String(req.query.query || '').trim().slice(0, 40);
  const status = ['included','excluded','below_minimum','needs_review'].includes(req.query.status) ? req.query.status : '';
  const dateClauses = {
    today:`date(datetime(d.received_at, '+9 hours')) = date(datetime('now', '+9 hours'))`,
    yesterday:`date(datetime(d.received_at, '+9 hours')) = date(datetime('now', '+9 hours', '-1 day'))`,
    '7d':`datetime(d.received_at, '+9 hours') >= datetime('now', '+9 hours', 'start of day', '-6 days')`,
    '30d':`datetime(d.received_at, '+9 hours') >= datetime('now', '+9 hours', 'start of day', '-29 days')`,
    month:`strftime('%Y-%m', datetime(d.received_at, '+9 hours')) = strftime('%Y-%m', datetime('now', '+9 hours'))`,
    all:'1 = 1'
  };
  const args = [req.user.id];
  let dateClause = dateClauses[range] || dateClauses.today;
  if (range === 'session') {
    const session = await activeSession();
    const state=await db.execute({sql:'SELECT broadcast_started_at broadcastStartedAt, broadcast_start_donation_id broadcastStartDonationId FROM users WHERE id=?',args:[req.user.id]});
    if(state.rows[0]?.broadcastStartDonationId!=null){dateClause=`d.id > ?`;args.push(Number(state.rows[0].broadcastStartDonationId));}
    else{dateClause=`d.received_at >= ?`;args.push(state.rows[0]?.broadcastStartedAt||session.started_at);}
  }
  if (range === 'custom') {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return res.status(400).json({ error:'조회 시작일과 종료일을 확인해주세요.' });
    dateClause = `date(datetime(d.received_at, '+9 hours')) BETWEEN date(?) AND date(?)`;
    args.push(from,to);
  }
  const clauses = [`d.recipient_user_id = ?`,dateClause];
  if (status) { clauses.push(`d.status = ?`); args.push(status); }
  if (query) { clauses.push(`(${effectiveDonorName} LIKE ? OR d.donor_name LIKE ?)`); args.push(`%${query}%`,`%${query}%`); }
  const where = clauses.join(' AND ');
  const fromSql = `FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE ${where}`;
  const [summary, rows, donorNames] = await Promise.all([
    db.execute({ sql:`SELECT COALESCE(SUM(d.amount),0) totalAmount, COUNT(*) depositCount, COUNT(DISTINCT ${effectiveDonorName}) donorCount, COALESCE(AVG(d.amount),0) averageAmount ${fromSql}`, args }),
    db.execute({ sql:`SELECT d.id, d.donor_name rawDonorName, ${effectiveDonorName} donorName, d.amount, d.bank, d.status, datetime(d.received_at, '+9 hours') receivedAt, CASE WHEN ${effectiveDonorName} <> d.donor_name THEN 1 ELSE 0 END nameAdjusted ${fromSql} ORDER BY d.received_at DESC, d.id DESC LIMIT 500`, args }),
    db.execute({ sql:`SELECT DISTINCT ${effectiveDonorName} donorName FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.recipient_user_id = ? ORDER BY donorName LIMIT 300`, args:[req.user.id] })
  ]);
  res.json({ range, summary:summary.rows[0], deposits:rows.rows, donorNames:donorNames.rows.map(row=>row.donorName) });
});

app.post('/api/my/deposits', requireAuth, async (req, res) => {
  try {
    const input = normalizeDonation({ ...req.body, bank:'manual', externalId:null });
    const receivedAt = new Date(req.body?.receivedAt);
    if (!req.body?.receivedAt || Number.isNaN(receivedAt.getTime())) {
      return res.status(400).json({ error:'입금 일시를 확인해주세요.' });
    }
    const now = Date.now();
    if (receivedAt.getTime() > now + 5 * 60 * 1000 || receivedAt.getTime() < Date.UTC(2000, 0, 1)) {
      return res.status(400).json({ error:'입금 일시는 2000년 이후, 현재 시각 이전으로 입력해주세요.' });
    }
    const session = await activeSession();
    const storedAt = receivedAt.toISOString().replace('T',' ').slice(0,19);
    const result = await db.execute({
      sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank, external_id, received_at) VALUES (?, ?, ?, ?, 'manual', NULL, ?)`,
      args:[session.id,req.user.id,input.donorName,input.amount,storedAt]
    });
    const saved = await db.execute({ sql:`SELECT id, donor_name donorName, amount, bank, datetime(received_at, '+9 hours') receivedAt FROM donations WHERE id = ?`, args:[result.lastInsertRowid] });
    const donation = await donationWithCrewGrade(saved.rows[0], req.user.id, await getUserSettings(req.user.id));
    publishOverlayDonation(donation, req.user.id);
    publishDataChange(req.user.id, 'deposit-created');
    res.status(201).json(donation);
  } catch (error) {
    res.status(400).json({ error:error.message });
  }
});

app.post('/api/my/deposits/test-alert', requireAuth, async (req, res) => {
  const amount=50000;
  const settings=await getUserSettings(req.user.id);
  const donation=await donationWithCrewGrade({ id:null, donorName:'폴조지', amount, bank:'test', receivedAt:new Date().toISOString() },req.user.id,settings);
  const delivered=publishOverlayTest(donation,req.user.id);
  res.json({ ok:true, delivered });
});

app.post('/api/my/deposits/:id/replay', requireAuth, async (req, res) => {
  const donationId=Number(req.params.id);
  const found=await db.execute({ sql:`SELECT d.id, ${effectiveDonorName} donorName, d.amount, d.bank, datetime(d.received_at, '+9 hours') receivedAt FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id=d.recipient_user_id AND a.raw_name=d.donor_name WHERE d.id=? AND d.recipient_user_id=? LIMIT 1`, args:[donationId,req.user.id] });
  if(!found.rows[0])return res.status(404).json({error:'입금 내역을 찾을 수 없습니다.'});
  const donation=await donationWithCrewGrade(found.rows[0],req.user.id,await getUserSettings(req.user.id));
  const delivered=publishOverlayTest(donation,req.user.id);
  res.json({ok:true,delivered});
});

app.put('/api/my/deposits/:id/donor', requireAuth, async (req, res) => {
  const donationId = Number(req.params.id);
  const canonicalName = String(req.body?.canonicalName || '').trim();
  const scope = req.body?.scope === 'same_name' ? 'same_name' : 'single';
  if (canonicalName.length > 40) return res.status(400).json({ error:'후원자 이름은 40자 이하로 입력해주세요.' });
  const found = await db.execute({ sql:'SELECT id, donor_name rawDonorName FROM donations WHERE id = ? AND recipient_user_id = ? LIMIT 1', args:[donationId,req.user.id] });
  const donation = found.rows[0];
  if (!donation) return res.status(404).json({ error:'입금 내역을 찾을 수 없습니다.' });
  if (scope === 'same_name') {
    if (canonicalName) {
      await db.execute({ sql:`INSERT INTO donor_aliases (recipient_user_id, raw_name, canonical_name, created_by_user_id) VALUES (?, ?, ?, ?) ON CONFLICT(recipient_user_id, raw_name) DO UPDATE SET canonical_name = excluded.canonical_name, created_by_user_id = excluded.created_by_user_id, updated_at = CURRENT_TIMESTAMP`, args:[req.user.id,donation.rawDonorName,canonicalName,req.user.id] });
    } else {
      await db.execute({ sql:'DELETE FROM donor_aliases WHERE recipient_user_id = ? AND raw_name = ?', args:[req.user.id,donation.rawDonorName] });
    }
    await db.execute({ sql:'UPDATE donations SET donor_override_name = NULL WHERE recipient_user_id = ? AND donor_name = ?', args:[req.user.id,donation.rawDonorName] });
  } else {
    await db.execute({ sql:'UPDATE donations SET donor_override_name = ? WHERE id = ?', args:[canonicalName || null,donationId] });
  }
  await db.execute({ sql:'INSERT INTO donor_name_changes (donation_id, changed_by_user_id, raw_name, canonical_name, scope) VALUES (?, ?, ?, ?, ?)', args:[donationId,req.user.id,donation.rawDonorName,canonicalName || null,scope] });
  publishDataChange(req.user.id, 'donor-updated');
  res.json({ ok:true });
});

app.put('/api/my/deposits/:id/status', requireAuth, async (req, res) => {
  const donationId = Number(req.params.id);
  const status = ['included','excluded','needs_review'].includes(req.body?.status) ? req.body.status : '';
  const note = String(req.body?.note || '').trim().slice(0, 200);
  if (!status) return res.status(400).json({ error:'처리 상태를 선택해주세요.' });
  const found = await db.execute({ sql:'SELECT id, status FROM donations WHERE id = ? AND recipient_user_id = ? LIMIT 1', args:[donationId,req.user.id] });
  const donation = found.rows[0];
  if (!donation) return res.status(404).json({ error:'입금 내역을 찾을 수 없습니다.' });
  if (donation.status !== status) {
    await db.execute({ sql:'UPDATE donations SET status = ? WHERE id = ?', args:[status,donationId] });
    await db.execute({ sql:'INSERT INTO donation_status_changes (donation_id, changed_by_user_id, previous_status, new_status, note) VALUES (?, ?, ?, ?, ?)', args:[donationId,req.user.id,donation.status,status,note || null] });
  }
  publishDataChange(req.user.id, 'status-updated');
  res.json({ ok:true, status });
});

app.get('/api/api-logs', requireAuth, requireManager, async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page,10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(req.query.pageSize,10) || 50));
  const offset = (page-1)*pageSize;
  const [result,count] = await Promise.all([
    db.execute({ sql:`SELECT id, method, path, request_headers requestHeaders, request_body requestBody, response_status responseStatus, response_body responseBody, remote_address remoteAddress, duration_ms durationMs, datetime(created_at, '+9 hours') createdAt FROM api_request_logs ORDER BY id DESC LIMIT ? OFFSET ?`, args:[pageSize,offset] }),
    db.execute('SELECT COUNT(*) total FROM api_request_logs')
  ]);
  const total = Number(count.rows[0]?.total || 0);
  const parse = value => { try { return JSON.parse(value); } catch { return value; } };
  const items = result.rows.map(row => ({ ...row, requestHeaders:parse(row.requestHeaders), requestBody:parse(row.requestBody), responseBody:parse(row.responseBody) }));
  res.json({ items, total, page, pageSize, totalPages:Math.max(1,Math.ceil(total/pageSize)) });
});

app.delete('/api/api-logs', requireAuth, requireManager, async (_req, res) => {
  await db.execute('DELETE FROM api_request_logs');
  res.json({ ok:true });
});

app.get('/api/notification-rules', requireAuth, requireSuper, async (_req, res) => {
  const result = await db.execute(`SELECT package_name packageName, title_pattern titlePattern, content_pattern contentPattern, created_at createdAt, updated_at updatedAt FROM notification_rules ORDER BY package_name`);
  res.json(result.rows);
});

app.post('/api/notification-rules', requireAuth, requireSuper, async (req, res) => {
  try {
    const rule = validateRuleInput(req.body);
    await db.execute({ sql:`INSERT INTO notification_rules (package_name, title_pattern, content_pattern) VALUES (?, ?, ?)`, args:[rule.packageName,rule.titlePattern,rule.contentPattern] });
    res.status(201).json(rule);
  } catch (error) {
    const duplicate = String(error.message).includes('UNIQUE');
    res.status(duplicate?409:400).json({ error:duplicate?'이미 등록된 앱 패키지명입니다.':error.message });
  }
});

app.put('/api/notification-rules/:packageName', requireAuth, requireSuper, async (req, res) => {
  try {
    const rule = validateRuleInput(req.body);
    const result = await db.execute({ sql:`UPDATE notification_rules SET package_name = ?, title_pattern = ?, content_pattern = ?, updated_at = CURRENT_TIMESTAMP WHERE package_name = ?`, args:[rule.packageName,rule.titlePattern,rule.contentPattern,req.params.packageName] });
    if (!result.rowsAffected) return res.status(404).json({ error:'정규식 규칙을 찾을 수 없습니다.' });
    res.json(rule);
  } catch (error) {
    const duplicate = String(error.message).includes('UNIQUE');
    res.status(duplicate?409:400).json({ error:duplicate?'이미 등록된 앱 패키지명입니다.':error.message });
  }
});

app.delete('/api/notification-rules/:packageName', requireAuth, requireSuper, async (req, res) => {
  const result = await db.execute({ sql:'DELETE FROM notification_rules WHERE package_name = ?', args:[req.params.packageName] });
  if (!result.rowsAffected) return res.status(404).json({ error:'정규식 규칙을 찾을 수 없습니다.' });
  res.json({ ok:true });
});

async function notificationApiUser(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Basic ')) return null;
  let credentials;
  try { credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); } catch { return null; }
  const separator = credentials.indexOf(':');
  if (separator < 1) return null;
  const result = await db.execute({ sql:`SELECT id, login_id loginId, display_name displayName, password_hash passwordHash FROM users WHERE login_id = ? COLLATE NOCASE AND is_active = 1 LIMIT 1`, args:[credentials.slice(0,separator).trim()] });
  const user = result.rows[0];
  return user && verifyPassword(credentials.slice(separator+1),user.passwordHash) ? user : null;
}

app.post('/api/notifications', async (req, res) => {
  const apiUser = await notificationApiUser(req);
  if (!apiUser) {
    res.setHeader('WWW-Authenticate','Basic realm="N9 SIGNAL Notification API"');
    return res.status(401).json({ error:'API 아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  req.notificationUserId = apiUser.id;
  const packageName = String(req.body?.packageName || '').trim();
  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  if (!packageName || packageName.length > 200 || !title || title.length > 1000 || !content || content.length > 5000) return res.status(400).json({ error:'packageName, title, content 값을 확인해주세요.' });
  const found = await db.execute({ sql:`SELECT package_name packageName, title_pattern titlePattern, content_pattern contentPattern FROM notification_rules WHERE package_name = ? LIMIT 1`, args:[packageName] });
  const rule = found.rows[0];
  if (!rule) {
    await db.execute({ sql:`INSERT INTO notification_events (package_name, title, content, status, error) VALUES (?, ?, ?, 'no_rule', ?)`, args:[packageName,title,content,'패키지 규칙이 없습니다.'] });
    return res.status(404).json({ error:'이 앱 패키지명에 등록된 규칙이 없습니다.' });
  }
  try {
    const parsed = parseNotification(rule, { title, content });
    if (!parsed) {
      await db.execute({ sql:`INSERT INTO notification_events (package_name, title, content, rule_package_name, status, error) VALUES (?, ?, ?, ?, 'not_matched', ?)`, args:[packageName,title,content,packageName,'정규식 불일치'] });
      return res.status(422).json({ error:'알림이 등록된 정규식과 일치하지 않습니다.' });
    }
    const settings = await getUserSettings(apiUser.id);
    if (parsed.amount < Number(settings.minimumDonationAmount || 0)) return res.status(202).json({ ignored:true, ...parsed });
    const session = await activeSession();
    const inserted = await db.execute({ sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank) VALUES (?, ?, ?, ?, ?)`, args:[session.id,apiUser.id,parsed.donorName,parsed.amount,packageName] });
    const donationId = Number(inserted.lastInsertRowid);
    await db.execute({ sql:`INSERT INTO notification_events (package_name, title, content, rule_package_name, donation_id, status) VALUES (?, ?, ?, ?, ?, 'created')`, args:[packageName,title,content,packageName,donationId] });
    publishDataChange(apiUser.id, 'deposit-created');
    res.status(201).json({ ok:true, donation:{ id:donationId, ...parsed }, packageName, recipient:{ loginId:apiUser.loginId, displayName:apiUser.displayName } });
  } catch (error) {
    await db.execute({ sql:`INSERT INTO notification_events (package_name, title, content, rule_package_name, status, error) VALUES (?, ?, ?, ?, 'parse_error', ?)`, args:[packageName,title,content,packageName,String(error.message).slice(0,500)] });
    res.status(422).json({ error:error.message });
  }
});

app.put('/api/my/deposits/:id/amount', requireAuth, async (req, res) => {
  const donationId = Number(req.params.id);
  const amount = Number(req.body?.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) {
    return res.status(400).json({ error:'금액은 1원 이상 1억원 이하의 정수로 입력해주세요.' });
  }
  const found = await db.execute({
    sql:'SELECT id FROM donations WHERE id = ? AND recipient_user_id = ? LIMIT 1',
    args:[donationId,req.user.id]
  });
  if (!found.rows[0]) return res.status(404).json({ error:'입금 내역을 찾을 수 없습니다.' });
  await db.execute({ sql:'UPDATE donations SET amount = ? WHERE id = ?', args:[amount,donationId] });
  publishDataChange(req.user.id, 'amount-updated');
  res.json({ ok:true, amount });
});

app.get('/api/my/deposits/events', requireAuth, (req, res) => {
  openDataChangeStream(req, res, req.user.id);
});

async function widgetDataForUser(userId) {
  const session = await activeSession();
  const state=await db.execute({sql:'SELECT broadcast_started_at broadcastStartedAt, broadcast_start_donation_id broadcastStartDonationId FROM users WHERE id=?',args:[userId]});
  const displayAfter=state.rows[0]?.broadcastStartedAt||session.display_after;
  const useStartId=state.rows[0]?.broadcastStartDonationId!=null;
  const startClause=useStartId?'d.id > ?':'d.received_at >= ?';
  const startValue=useStartId?Number(state.rows[0].broadcastStartDonationId):displayAfter;
  const [donations, ranking, adjustments] = await Promise.all([
    db.execute({ sql:`SELECT d.id, ${effectiveDonorName} donorName, d.amount, datetime(d.received_at, '+9 hours') receivedAt FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.recipient_user_id = ? AND ${startClause} AND d.status = 'included' ORDER BY d.id DESC LIMIT 20`, args:[userId,startValue] }),
    db.execute({ sql:`SELECT ${effectiveDonorName} donorName, SUM(d.amount) amount, COUNT(*) count, MAX(d.received_at) lastReceivedAt FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.recipient_user_id = ? AND ${startClause} AND d.status = 'included' GROUP BY ${effectiveDonorName} ORDER BY amount DESC, lastReceivedAt DESC LIMIT 60`, args:[userId,startValue] }),
    db.execute({ sql:'SELECT donor_name donorName, amount FROM ranking_adjustments WHERE session_id = ? AND recipient_user_id = ?', args:[session.id,userId] })
  ]);
  const merged = new Map(ranking.rows.map(row => [row.donorName, { ...row, amount:Number(row.amount), count:Number(row.count) }]));
  for (const row of adjustments.rows) {
    const current = merged.get(row.donorName) || { donorName:row.donorName, amount:0, count:0 };
    current.amount += Number(row.amount);
    merged.set(row.donorName, current);
  }
  const visibleRanking = [...merged.values()].filter(row => row.amount > 0).sort((a,b) => b.amount - a.amount || String(b.lastReceivedAt||'').localeCompare(String(a.lastReceivedAt||'')) || a.donorName.localeCompare(b.donorName, 'ko')).slice(0,60);
  return { donations:donations.rows, ranking:visibleRanking };
}

app.get('/api/obs/sources', requireAuth, async (req, res) => {
  const result = await db.execute({ sql:'SELECT obs_token obsToken FROM users WHERE id = ? LIMIT 1', args:[req.user.id] });
  const obsToken = result.rows[0]?.obsToken;
  if (!obsToken) return res.status(500).json({ error:'OBS 전용 주소를 준비하지 못했습니다.' });
  res.json({ alertPath:`/overlay/${obsToken}`, rankingPath:`/ranking/${obsToken}` });
});

app.post('/api/my/broadcast/start', requireAuth, async (req,res)=>{
  const latest=await db.execute({sql:'SELECT COALESCE(MAX(id),0) lastDonationId FROM donations WHERE recipient_user_id=?',args:[req.user.id]});
  await db.execute({sql:'UPDATE users SET broadcast_started_at=CURRENT_TIMESTAMP, broadcast_start_donation_id=? WHERE id=?',args:[Number(latest.rows[0].lastDonationId)||0,req.user.id]});
  const session=await activeSession();
  await db.execute({sql:'DELETE FROM ranking_adjustments WHERE session_id=? AND recipient_user_id=?',args:[session.id,req.user.id]});
  publishDataChange(req.user.id,'broadcast-started');
  res.json({ok:true});
});

app.get('/api/widgets', requireAuth, async (req, res) => {
  res.json(await widgetDataForUser(req.user.id));
});

app.get('/api/widgets/:token', async (req, res) => {
  const user = await getObsUser(req.params.token);
  if (!user) return res.status(404).json({ error:'유효하지 않은 OBS 주소입니다.' });
  res.json({ ...(await widgetDataForUser(user.id)), settings:overlaySettings(await getUserSettings(user.id)) });
});

app.get('/api/widgets/:token/events', async (req, res) => {
  const user = await getObsUser(req.params.token);
  if (!user) return res.status(404).json({ error:'유효하지 않은 OBS 주소입니다.' });
  openDataChangeStream(req, res, user.id);
});

app.post('/api/widgets/:token/manual-donation', async (req, res) => {
  try {
    const user = await getObsUser(req.params.token);
    if (!user) return res.status(404).json({ error:'유효하지 않은 OBS 주소입니다.' });
    const input = normalizeDonation({ ...req.body, bank:'manual', externalId:null });
    const session = await activeSession();
    const result = await db.execute({
      sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank, external_id) VALUES (?, ?, ?, ?, 'manual', NULL)`,
      args:[session.id,user.id,input.donorName,input.amount]
    });
    publishDataChange(user.id, 'deposit-created');
    res.status(201).json({ ok:true, id:Number(result.lastInsertRowid) });
  } catch (error) {
    res.status(400).json({ error:error.message });
  }
});

app.put('/api/widgets/:token/ranking', async (req, res) => {
  try {
    const user = await getObsUser(req.params.token);
    if (!user) return res.status(404).json({ error:'유효하지 않은 OBS 주소입니다.' });
    const source = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (source.length > 60) return res.status(400).json({ error:'순위는 최대 60명까지 입력할 수 있습니다.' });
    const desired = new Map();
    for (const row of source) {
      const donorName = String(row?.donorName || '').trim();
      const amount = Math.floor(Number(row?.amount));
      if (!donorName || donorName.length > 40) return res.status(400).json({ error:'닉네임은 1~40자로 입력해주세요.' });
      if (!Number.isSafeInteger(amount) || amount < 1) return res.status(400).json({ error:`${donorName}의 금액을 확인해주세요.` });
      if (desired.has(donorName)) return res.status(400).json({ error:`${donorName} 닉네임이 중복되었습니다.` });
      desired.set(donorName, amount);
    }
    const session = await activeSession();
    const base = await db.execute({ sql:`SELECT ${effectiveDonorName} donorName, SUM(d.amount) amount FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.session_id = ? AND d.recipient_user_id = ? AND d.received_at >= ? AND d.status = 'included' GROUP BY ${effectiveDonorName}`, args:[session.id,user.id,session.display_after] });
    const baseMap = new Map(base.rows.map(row => [row.donorName, Number(row.amount)]));
    await db.execute({ sql:'DELETE FROM ranking_adjustments WHERE session_id = ? AND recipient_user_id = ?', args:[session.id,user.id] });
    for (const donorName of new Set([...baseMap.keys(), ...desired.keys()])) {
      const adjustment = (desired.get(donorName) || 0) - (baseMap.get(donorName) || 0);
      if (adjustment !== 0) await db.execute({ sql:'INSERT INTO ranking_adjustments (session_id, recipient_user_id, donor_name, amount) VALUES (?, ?, ?, ?)', args:[session.id,user.id,donorName,adjustment] });
    }
    publishDataChange(user.id, 'ranking-updated');
    res.json({ ok:true, ranking:(await widgetDataForUser(user.id)).ranking });
  } catch (error) {
    res.status(400).json({ error:error.message });
  }
});

app.get('/api/overlay/:token/bootstrap', async (req, res) => {
  const user = await getObsUser(req.params.token);
  if (!user) return res.status(404).json({ error:'유효하지 않은 OBS 주소입니다.' });
  const session = await activeSession();
  const latest = await db.execute({ sql:'SELECT COALESCE(MAX(id), 0) lastDonationId FROM donations WHERE session_id = ? AND recipient_user_id = ?', args:[session.id,user.id] });
  res.json({ lastDonationId:Number(latest.rows[0].lastDonationId)||0, settings:overlaySettings(await getUserSettings(user.id)) });
});

app.get('/api/overlay/preview', requireAuth, async (req, res) => {
  const settings=await settingsWithCrewPreview(req.user);
  res.json({ lastDonationId:0, settings, previewDonation:{ id:null, isTest:true, donorName:settings.previewDonorName, amount:50000, cumulativeAmount:settings.previewCumulativeAmount, crewGradeId:settings.previewCrewGradeId } });
});

app.post('/api/overlay/preview-session', requireAuth, async (req, res) => {
  const settings = await settingsWithCrewPreview(req.user);
  const token = randomBytes(24).toString('hex');
  overlayPreviewSessions.set(token, {
    expiresAt:Date.now()+60000,
    payload:{ lastDonationId:0, settings:overlaySettings(settings), previewDonation:{ id:null, isTest:true, donorName:settings.previewDonorName, amount:50000, cumulativeAmount:settings.previewCumulativeAmount, crewGradeId:settings.previewCrewGradeId } }
  });
  for (const [key, value] of overlayPreviewSessions) if (value.expiresAt < Date.now()) overlayPreviewSessions.delete(key);
  res.json({ token });
});

app.get('/api/overlay/preview-session/:token', async (req, res) => {
  const preview = overlayPreviewSessions.get(req.params.token);
  if (!preview || preview.expiresAt < Date.now()) {
    overlayPreviewSessions.delete(req.params.token);
    return res.status(404).json({ error:'미리보기 시간이 만료되었습니다. 다시 열어주세요.' });
  }
  res.json(preview.payload);
});

app.get('/api/overlay/:token/events', async (req, res) => {
  const user = await getObsUser(req.params.token);
  if (!user) return res.status(404).json({ error:'유효하지 않은 OBS 주소입니다.' });
  res.set({
    'Content-Type':'text/event-stream',
    'Cache-Control':'no-cache, no-transform',
    'Connection':'keep-alive',
    'X-Accel-Buffering':'no'
  });
  res.flushHeaders();

  const requestedAfter = Math.max(0, Number(req.get('Last-Event-ID')) || Number(req.query.after) || 0);
  const resuming = Boolean(req.get('Last-Event-ID') || req.query.after);
  const client = { res, userId:user.id, ready:false, pending:[] };
  overlayClients.add(client);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  res.on('close', () => {
    clearInterval(heartbeat);
    overlayClients.delete(client);
  });

  try {
    const session = await activeSession();
    const [latest, settings, missed] = await Promise.all([
      db.execute({ sql:'SELECT COALESCE(MAX(id), 0) lastDonationId FROM donations WHERE session_id = ? AND recipient_user_id = ?', args:[session.id,user.id] }),
      getUserSettings(user.id),
      resuming
        ? db.execute({ sql:`SELECT d.id, ${effectiveDonorName} donorName, d.amount, d.bank, datetime(d.received_at, '+9 hours') receivedAt FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.session_id = ? AND d.recipient_user_id = ? AND d.id > ? AND d.status = 'included' ORDER BY d.id ASC`, args:[session.id,user.id,requestedAfter] })
        : Promise.resolve({ rows:[] })
    ]);
    const latestId = Number(latest.rows[0].lastDonationId) || 0;
    sendOverlayEvent(res, 'bootstrap', { lastDonationId:resuming ? requestedAfter : latestId, settings:overlaySettings(settings) }, resuming ? requestedAfter : latestId);

    const queued = [...missed.rows, ...client.pending]
      .filter(donation => settings.toonationUseOwnAlert || donation.bank !== 'toonation')
      .filter((donation, index, rows) => donation.id > requestedAfter && rows.findIndex(row => row.id === donation.id) === index)
      .sort((a,b) => a.id - b.id);
    client.ready = true;
    client.pending = [];
    for (const donation of queued) sendOverlayEvent(res, 'donation', donation, donation.id);
  } catch (error) {
    sendOverlayEvent(res, 'stream-error', { message:'OBS 이벤트 스트림을 시작하지 못했습니다.' });
    res.end();
  }
});

app.get('/api/donations', async (req, res) => {
  const after = Math.max(0, Number(req.query.after) || 0);
  const session = await activeSession();
  const savedSettings = await db.execute('SELECT value FROM settings WHERE id = 1');
  const settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings.rows[0].value) };
  const result = await db.execute({ sql:`SELECT d.id, ${effectiveDonorName} donorName, d.amount, d.bank, datetime(d.received_at, '+9 hours') receivedAt FROM donations d LEFT JOIN donor_aliases a ON a.recipient_user_id = d.recipient_user_id AND a.raw_name = d.donor_name WHERE d.session_id = ? AND d.id > ? AND d.amount >= ? AND d.status = 'included' ORDER BY d.id ASC LIMIT 50`, args:[session.id,after,settings.alertMinimumAmount] });
  res.json(result.rows);
});

app.post('/api/donations', requireAuth, async (req, res) => {
  try {
    const input = normalizeDonation(req.body);
    const settings = await getUserSettings(req.user.id);
    if (input.amount < Number(settings.minimumDonationAmount || 0)) {
      return res.status(202).json({ ignored:true, minimumDonationAmount:settings.minimumDonationAmount, message:`${settings.minimumDonationAmount.toLocaleString('ko-KR')}원 미만 입금은 후원 리스트에 기록하지 않습니다.` });
    }
    const session = await activeSession();
    const result = await db.execute({ sql:`INSERT INTO donations (session_id, recipient_user_id, donor_name, amount, bank, external_id) VALUES (?, ?, ?, ?, ?, ?)`, args:[session.id,req.user.id,input.donorName,input.amount,input.bank,input.externalId] });
    const saved = await db.execute({ sql:`SELECT id, donor_name donorName, amount, bank, datetime(received_at, '+9 hours') receivedAt FROM donations WHERE id = ?`, args:[result.lastInsertRowid] });
    const donation = await donationWithCrewGrade(saved.rows[0], req.user.id, settings);
    publishOverlayDonation(donation, req.user.id);
    publishDataChange(req.user.id, 'deposit-created');
    res.status(201).json(donation);
  } catch (error) {
    const duplicate = String(error.message).includes('UNIQUE constraint');
    res.status(duplicate ? 409 : 400).json({ error:duplicate ? '이미 처리한 입금입니다.' : error.message });
  }
});

app.get('/api/settings', requireAuth, async (req, res) => {
  res.json(await settingsWithCrewPreview(req.user));
});

app.get('/api/toonation/status', requireAuth, async (req, res) => {
  res.json(toonationManager.status(req.user.id));
});

app.post('/api/toonation/reconnect', requireAuth, async (req, res) => {
  const settings = await getUserSettings(req.user.id);
  toonationManager.reconnect(req.user.id, settings);
  res.json({ ok:true, status:toonationManager.status(req.user.id) });
});

app.put('/api/settings', requireAuth, async (req, res) => {
  if(req.user.role==='super'&&Array.isArray(req.body?.crewGrades)){
    const ranges=req.body.crewGrades.map(grade=>({min:Number(grade.minAmount)||0,max:grade.maxAmount==null||grade.maxAmount===''?null:Number(grade.maxAmount)})).sort((a,b)=>a.min-b.min);
    if(ranges.some(range=>range.max!=null&&range.max<range.min))return res.status(400).json({error:'크루 등급의 최대 누적 금액은 최소 누적 금액보다 크거나 같아야 합니다.'});
    if(ranges.some((range,index)=>index>0&&(ranges[index-1].max==null||range.min<=ranges[index-1].max)))return res.status(400).json({error:'크루 등급의 누적 금액 구간이 서로 겹치지 않게 입력해주세요.'});
  }
  const settings = cleanSettings(req.body);
  if (settings.toonationEnabled && !toonationWidgetKey(settings.toonationWidgetUrl)) {
    return res.status(400).json({ error:'투네이션 공식 알림 위젯 URL을 확인해주세요.' });
  }
  if(req.user.role!=='super')settings.crewGrades=[];
  await db.execute({ sql:`INSERT INTO user_settings (user_id, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`, args:[req.user.id,JSON.stringify(settings)] });
  toonationManager.configure(req.user.id, settings);
  if(req.user.role!=='super')settings.crewGrades=await getSharedCrewGrades();
  const savedSettings = await settingsWithCrewPreview(req.user);
  publishOverlaySettings(savedSettings, req.user.id);
  publishDataChange(req.user.id, 'settings-updated');
  res.json(savedSettings);
});

app.post('/api/sessions', requireAuth, async (req, res) => {
  const current = await activeSession();
  await db.execute({ sql:'UPDATE broadcast_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?', args:[current.id] });
  const title = String(req.body?.title || `방송 ${Number(current.id)+1}회차`).trim().slice(0,60);
  const result = await db.execute({ sql:'INSERT INTO broadcast_sessions (title) VALUES (?)', args:[title] });
  const created = await db.execute({ sql:'SELECT * FROM broadcast_sessions WHERE id = ?', args:[result.lastInsertRowid] });
  res.status(201).json(created.rows[0]);
});

app.post('/api/display/reset', requireAuth, async (_req, res) => {
  const session = await activeSession();
  await db.execute({ sql:'UPDATE broadcast_sessions SET display_after = CURRENT_TIMESTAMP WHERE id = ?', args:[session.id] });
  publishDataChange(_req.user.id, 'display-reset');
  res.json({ ok:true });
});

app.post('/api/display/restore', requireAuth, async (_req, res) => {
  const session = await activeSession();
  await db.execute({ sql:'UPDATE broadcast_sessions SET display_after = started_at WHERE id = ?', args:[session.id] });
  publishDataChange(_req.user.id, 'display-restored');
  res.json({ ok:true });
});
