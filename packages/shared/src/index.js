export const MINIMUM_DONATION_AMOUNT = 10000;

export const DEFAULT_SETTINGS = Object.freeze({
  messageTemplate: '{name}님\n{amount}원 감사합니다!',
  durationMs: 5000,
  fontSize: 54,
  fontWeight: 800,
  fontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
  customFontFamily: '',
  textAlign: 'center',
  lineHeight: 1.35,
  letterSpacing: 0,
  textColor: '#ffffff',
  nameColorEnabled: false,
  nameColor: '#7dd3fc',
  amountColorEnabled: false,
  amountColor: '#facc15',
  suffixStyleEnabled: false,
  suffixColor: '#ffffff',
  suffixFontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
  outlineEnabled: true,
  outlineColor: '#000000',
  outlineWidth: 3,
  textShadow: true,
  backgroundEnabled: false,
  backgroundColorEnabled: true,
  backgroundColor: '#151522',
  backgroundOpacity: 0.82,
  backgroundPadding: 28,
  backgroundRadius: 24,
  backgroundImageData: '',
  backgroundImageName: '',
  backgroundImageArea: 'alert',
  backgroundImageFit: 'cover',
  backgroundImageScale: 100,
  backgroundImagePositionX: 50,
  backgroundImagePositionY: 50,
  animation: 'zoom',
  exitAnimation: 'fade-out',
  soundEnabled: true,
  soundPreset: 'coin',
  soundVolume: 70,
  customSoundName: '',
  customSoundData: '',
  soundLibrary: [],
  ttsEnabled: false,
  ttsProvider: 'typecast',
  ttsVoiceURI: '',
  ttsElevenVoiceId: '',
  ttsElevenVoiceName: '',
  ttsModel: 'eleven_flash_v2_5',
  ttsTypecastVoiceId: '',
  ttsTypecastVoiceName: '',
  ttsTypecastEmotion: 'smart',
  ttsRate: 1,
  ttsPitch: 0,
  ttsVolume: 100,
  ttsWordReplacements: [],
  crewTtsWordReplacements: [],
  amountTiers: [],
  crewGradeEnabled: false,
  crewGradeMinimumAmount: 1000000,
  crewGradeImageData: '',
  crewGradeImageName: '',
  crewGradeImageSize: 208,
  crewGradeDisplayMode: 'image',
  crewGradeTextColor: '#ffffff',
  crewGradeTextFontFamily: 'Pretendard, "Noto Sans KR", sans-serif',
  crewGradeTextSize: 54,
  crewGrades: [],
  minimumDonationAmount: MINIMUM_DONATION_AMOUNT,
  alertMinimumAmount: MINIMUM_DONATION_AMOUNT,
  alertOverlayEnabled: true,
  rankingOverlayEnabled: true,
  toonationEnabled: false,
  toonationWidgetUrl: '',
  toonationAlertMode: 'official',
  toonationUseOwnAlert: false,
  youtubeChatEnabled: false,
  youtubeApiKey: '',
  youtubeVideoId: '',
  youtubeMatchWindowSeconds: 30,
  youtubeMessageMaxLength: 200,
  youtubeChatMinimumAmount: 0,
  rankingTitle: '오늘의 후원',
  rankingCanvasVersion: 2,
  rankingLimit: 3,
  rankingFontFamily: '"Noto Sans KR", sans-serif',
  rankingFontSize: 48,
  rankingFontWeight: 700,
  rankingTitleFontWeight: 700,
  rankingNameFontWeight: 700,
  rankingAmountFontWeight: 700,
  rankingUseLineHeight: false,
  rankingLineHeight: 1.2,
  rankingLetterSpacing: 0,
  rankingRowGap: 10,
  rankingColumnGap: 24,
  rankingNameAlign: 'left',
  rankingAmountAlign: 'right',
  rankingRowAlign: 'spread',
  rankingTheme: 'midnight',
  rankingBackgroundEnabled: false,
  rankingCustomBackground: '#101b30',
  rankingCustomBorderEnabled: true,
  rankingCustomBorder: '#345174',
  rankingCustomRowBackgroundEnabled: true,
  rankingCustomRowBackground: '#16243a',
  rankingCustomRadius: 18,
  rankingCustomMarker: 'circle',
  rankingNameSuffix: '',
  rankingAmountSuffix: '원',
  rankingNameSuffixColor: '#ffffff',
  rankingAmountSuffixColor: '#b9dcff',
  rankingShowTitle: true,
  rankingTitleSize: 36,
  rankingTitleAlign: 'left',
  rankingTitleColumn: 'first',
  rankingTitleColor: '#ffffff',
  rankingTitleOutlineEnabled: false,
  rankingTitleOutlineColor: '#000000',
  rankingTitleOutlineWidth: 2,
  rankingNameColor: '#ffffff',
  rankingNameOutlineEnabled: false,
  rankingNameOutlineColor: '#000000',
  rankingNameOutlineWidth: 2,
  rankingAmountColor: '#b9dcff',
  rankingAmountOutlineEnabled: false,
  rankingAmountOutlineColor: '#000000',
  rankingAmountOutlineWidth: 2,
  rankingColumns: 1,
  rankingRowsPerColumn: 10,
  rankingAnimation: 'fade',
  rankingShowRank: true,
  rankingShowCount: false,
  rankingRankHighlightEnabled: true,
  rankingRankStyles: [
    { color:'#ffd76a', amountColor:'#b9dcff', badge:'#8a6414', size:110, weight:900 },
    { color:'#dce8f5', amountColor:'#b9dcff', badge:'#60758b', size:105, weight:800 },
    { color:'#e7aa78', amountColor:'#b9dcff', badge:'#855137', size:102, weight:800 },
    { color:'#ffffff', badge:'#315b88', size:100, weight:700 }
  ]
});

export function normalizeDonation(input) {
  const donorName = String(input?.donorName ?? '').trim();
  const amount = Number(input?.amount);
  const bank = String(input?.bank ?? '테스트').trim();
  const externalId = input?.externalId ? String(input.externalId).trim() : null;
  if (!donorName || donorName.length > 40) throw new Error('입금자명은 1~40자로 입력해주세요.');
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) throw new Error('금액은 1원 이상 1억원 이하의 정수여야 합니다.');
  return { donorName, amount, bank: bank || '기타', externalId };
}

export function formatWon(amount) {
  return new Intl.NumberFormat('ko-KR').format(amount);
}

export function validateAmountTiers(tiers) {
  if (!Array.isArray(tiers)) return;
  if (tiers.length > 12) throw new Error('금액 구간은 최대 12개까지 등록할 수 있습니다.');
  const ranges = tiers.map((tier, index) => {
    const min = Number(tier?.minAmount);
    const max = tier?.maxAmount == null || tier.maxAmount === '' ? null : Number(tier.maxAmount);
    if (!Number.isSafeInteger(min) || min < 0 || min > 100000000) {
      throw new Error(`${index + 1}번째 금액 구간의 최소 금액을 0원 이상 1억원 이하의 정수로 입력해주세요.`);
    }
    if (max != null && (!Number.isSafeInteger(max) || max < 0 || max > 100000000)) {
      throw new Error(`${index + 1}번째 금액 구간의 최대 금액을 0원 이상 1억원 이하의 정수로 입력해주세요.`);
    }
    if (max != null && max < min) {
      throw new Error(`${index + 1}번째 금액 구간의 최대 금액은 최소 금액보다 크거나 같아야 합니다.`);
    }
    return { min, max, index };
  }).sort((a, b) => a.min - b.min || a.index - b.index);
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (previous.max == null || current.min <= previous.max) {
      throw new Error('금액 구간이 서로 겹치지 않게 입력해주세요. 경계 금액도 한 구간에만 포함되어야 합니다.');
    }
  }
}

export function normalizeTtsWordReplacements(items) {
  if (!Array.isArray(items)) return [];
  if (items.length > 100) throw new Error('금지 단어는 최대 100개까지 등록할 수 있습니다.');
  const seen = new Set();
  return items.map((item, index) => {
    const source = String(item?.source || '').trim();
    const replacement = String(item?.replacement || '').trim();
    if (!source || !replacement) throw new Error(`${index + 1}번째 금지 단어와 바뀌는 단어를 모두 입력해주세요.`);
    if (source.length > 50 || replacement.length > 100) throw new Error('금지 단어는 50자, 바뀌는 단어는 100자 이하로 입력해주세요.');
    const key = source.toLocaleLowerCase('ko-KR');
    if (seen.has(key)) throw new Error(`‘${source}’ 금지 단어가 중복 등록되어 있습니다.`);
    seen.add(key);
    return { source, replacement };
  });
}

export function applyTtsWordReplacements(text, items) {
  const replacements = normalizeTtsWordReplacements(items);
  if (!replacements.length) return String(text || '');
  const bySource = new Map(replacements.map((item) => [item.source.toLocaleLowerCase('ko-KR'), item.replacement]));
  const pattern = replacements
    .map((item) => item.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|');
  return String(text || '').replace(new RegExp(pattern, 'giu'), (match) => bySource.get(match.toLocaleLowerCase('ko-KR')) || match);
}
