const API_BASE = 'https://api.elevenlabs.io';
const DEFAULT_MODEL = 'eleven_flash_v2_5';

function apiKey() {
  return String(process.env.ELEVENLABS_API_KEY || '').trim();
}

export function elevenLabsConfigured() {
  return Boolean(apiKey());
}

async function elevenFetch(path, options = {}) {
  if (!elevenLabsConfigured()) {
    const error = new Error('ElevenLabs API 키가 설정되지 않았습니다.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'xi-api-key': apiKey(),
      ...(options.body ? { 'Content-Type':'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('ElevenLabs API 오류:', response.status, detail.slice(0, 500));
    const error = new Error(
      response.status === 401
        ? 'ElevenLabs API 키를 확인해주세요.'
        : 'ElevenLabs 서버 요청에 실패했습니다.',
    );
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  return response;
}

export async function listElevenVoices() {
  const response = await elevenFetch('/v2/voices?page_size=100&sort=name&sort_direction=asc');
  const data = await response.json();
  return (data.voices || []).map((voice) => ({
    id: String(voice.voice_id || ''),
    name: String(voice.name || '이름 없는 음성'),
    category: String(voice.category || ''),
    description: String(voice.description || ''),
    labels: voice.labels && typeof voice.labels === 'object' ? voice.labels : {},
    languages: (voice.verified_languages || []).map((item) => ({
      language: String(item.language || ''),
      locale: String(item.locale || ''),
      accent: String(item.accent || ''),
    })),
  })).filter((voice) => voice.id);
}

export async function createElevenSpeech({ text, voiceId, model = DEFAULT_MODEL, rate = 1 }) {
  const safeText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const safeVoiceId = String(voiceId || '').trim();
  if (!safeText) {
    const error = new Error('읽을 문구가 없습니다.');
    error.status = 400;
    throw error;
  }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(safeVoiceId)) {
    const error = new Error('ElevenLabs 목소리를 선택해주세요.');
    error.status = 400;
    throw error;
  }
  const safeModel = model === 'eleven_multilingual_v2'
    ? 'eleven_multilingual_v2'
    : DEFAULT_MODEL;
  const safeRate = Math.max(0.7, Math.min(1.2, Number(rate) || 1));
  const response = await elevenFetch(
    `/v1/text-to-speech/${encodeURIComponent(safeVoiceId)}?output_format=mp3_44100_128`,
    {
      method:'POST',
      body:JSON.stringify({
        text:safeText,
        model_id:safeModel,
        voice_settings:{ stability:0.55, similarity_boost:0.75, style:0, use_speaker_boost:true, speed:safeRate },
      }),
    },
  );
  return Buffer.from(await response.arrayBuffer());
}
