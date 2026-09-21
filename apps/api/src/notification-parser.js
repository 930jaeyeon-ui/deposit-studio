const MAX_PATTERN_LENGTH = 500;

export function compilePattern(pattern, label) {
  const source = String(pattern || '').trim();
  if (!source) return null;
  if (source.length > MAX_PATTERN_LENGTH) throw new Error(`${label} 정규식은 ${MAX_PATTERN_LENGTH}자 이하로 입력해주세요.`);
  try {
    return new RegExp(source, 'u');
  } catch (error) {
    throw new Error(`${label} 정규식이 올바르지 않습니다: ${error.message}`);
  }
}

export function parseNotification(rule, notification) {
  const title = String(notification?.title ?? '').slice(0, 1000);
  const content = String(notification?.content ?? '').slice(0, 5000);
  const titleRegex = compilePattern(rule.titlePattern, '제목');
  const contentRegex = compilePattern(rule.contentPattern, '내용');
  if (!contentRegex) throw new Error('내용 정규식을 입력해주세요.');
  const titleMatch = titleRegex ? titleRegex.exec(title) : null;
  if (titleRegex && !titleMatch) return null;
  const contentMatch = contentRegex.exec(content);
  if (!contentMatch) return null;
  const groups = { ...(titleMatch?.groups || {}), ...(contentMatch.groups || {}) };
  const donorName = String(groups.donor || '').trim();
  const amountText = String(groups.amount || '').trim();
  const amountDigits = amountText.replace(/[^0-9]/g, '');
  const amount = Number(amountDigits);
  if (!donorName) throw new Error('정규식 결과에 donor 캡처 그룹이 없습니다.');
  if (donorName.length > 40) throw new Error('추출된 입금자명이 40자를 초과합니다.');
  if (!amountDigits || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) {
    throw new Error('amount 캡처 그룹에서 1원 이상 1억원 이하 금액을 추출할 수 없습니다.');
  }
  return { donorName, amount };
}

export function validateRuleInput(input) {
  const packageName = String(input?.packageName || '').trim();
  const titlePattern = String(input?.titlePattern || '').trim();
  const contentPattern = String(input?.contentPattern || '').trim();
  if (!/^[A-Za-z0-9._-]{3,200}$/.test(packageName)) throw new Error('앱 패키지명을 확인해주세요.');
  if (!contentPattern) throw new Error('내용 정규식을 입력해주세요.');
  compilePattern(titlePattern, '제목');
  compilePattern(contentPattern, '내용');
  return { packageName, titlePattern, contentPattern };
}
