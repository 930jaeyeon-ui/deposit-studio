export const DEFAULT_SETTINGS = Object.freeze({
  messageTemplate: '{name}님\n{amount}원 감사합니다!',
  durationMs: 5000,
  fontSize: 54,
  fontWeight: 800,
  textColor: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 3,
  backgroundColor: '#151522',
  backgroundOpacity: 0.82,
  animation: 'zoom',
  minimumDonationAmount: 1000,
  rankingTitle: '오늘의 후원',
  rankingLimit: 10,
  rankingFontSize: 30,
  rankingRowGap: 10,
  rankingAlign: 'left',
  rankingTheme: 'midnight',
  rankingShowRank: true,
  rankingShowCount: false
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
