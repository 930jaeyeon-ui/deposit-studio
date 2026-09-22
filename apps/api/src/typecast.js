import { TypecastClient } from '@neosapience/typecast-js';

function apiKey() {
  return String(process.env.TYPECAST_API_KEY || '').trim();
}

export function typecastConfigured() {
  return Boolean(apiKey());
}

function client() {
  if (!typecastConfigured()) {
    const error = new Error('Typecast API 키가 설정되지 않았습니다.');
    error.status = 503;
    throw error;
  }
  return new TypecastClient({ apiKey:apiKey() });
}

function normalizeError(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  const message = status === 401
    ? 'Typecast API 키를 확인해주세요.'
    : status === 402
      ? 'Typecast 사용 가능 크레딧이 부족합니다.'
      : status === 429
        ? 'Typecast 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'
        : 'Typecast 서버 요청에 실패했습니다.';
  const normalized = new Error(message);
  normalized.status = status === 429 ? 429 : status >= 400 && status < 500 ? 400 : 502;
  return normalized;
}

export async function listTypecastVoices() {
  try {
    const voices = await client().getVoicesV3({ model:'ssfm-v30' });
    return (voices || []).map((voice) => ({
      id:String(voice.voice_id || ''),
      name:String(voice.voice_name?.kor || voice.voice_name?.eng || voice.voice_name || '이름 없는 음성'),
      englishName:String(voice.voice_name?.eng || ''),
      type:String(voice.voice_type || ''),
      gender:String(voice.gender || ''),
      age:String(voice.age || ''),
      useCases:Array.isArray(voice.use_cases) ? voice.use_cases.map(String) : [],
      emotions:[...new Set((voice.models || []).flatMap((model) => model.version === 'ssfm-v30' ? model.emotions || [] : []).map(String))],
      previewUrl:String(voice.preview_url || ''),
    })).filter((voice) => voice.id);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function createTypecastSpeech({ text, voiceId, rate = 1, pitch = 0, emotion = 'smart' }) {
  const safeText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const safeVoiceId = String(voiceId || '').trim();
  if (!safeText) {
    const error = new Error('읽을 문구가 없습니다.');
    error.status = 400;
    throw error;
  }
  if (!/^(tc|uc)_[A-Za-z0-9_-]{8,100}$/.test(safeVoiceId)) {
    const error = new Error('Typecast 목소리를 선택해주세요.');
    error.status = 400;
    throw error;
  }
  const allowedEmotions = new Set(['normal','happy','sad','angry','whisper','toneup','tonedown']);
  const prompt = emotion === 'smart'
    ? { emotion_type:'smart' }
    : { emotion_type:'preset', emotion_preset:allowedEmotions.has(emotion) ? emotion : 'normal', emotion_intensity:1 };
  try {
    const result = await client().textToSpeech({
      text:safeText,
      voice_id:safeVoiceId,
      model:'ssfm-v30',
      language:'kor',
      prompt,
      output:{ audio_tempo:Math.max(0.5, Math.min(2, Number(rate) || 1)), audio_pitch:Math.max(-12, Math.min(12, Number(pitch) || 0)), audio_format:'mp3' },
    });
    return Buffer.from(result.audioData);
  } catch (error) {
    throw normalizeError(error);
  }
}
