import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotification, validateRuleInput } from '../src/notification-parser.js';

const rule = {
  packageName:'com.example.bank', contentPattern:'(?<donor>.+?)님.*?(?<amount>[\\d,]+)원'
};

test('알림 내용에서 입금자 및 금액을 추출한다', () => {
  assert.deepEqual(parseNotification(rule, { title:'입금 알림', content:'홍길동님이 50,000원을 입금했습니다.' }), { donorName:'홍길동', amount:50000 });
});

test('내용이 규칙과 다르면 null을 반환한다', () => {
  assert.equal(parseNotification(rule, { title:'입금 알림', content:'일치하지 않는 내용' }), null);
});

test('제목에서 금액을, 내용에서 입금자를 추출한다', () => {
  const splitRule = {
    packageName:'com.example.bank',
    titlePattern:'입금\\s+(?<amount>[\\d,]+)원',
    contentPattern:'입금자\\s*[:：]\\s*(?<donor>.+)'
  };
  assert.deepEqual(parseNotification(splitRule, { title:'입금 75,000원', content:'입금자: 김철수' }), { donorName:'김철수', amount:75000 });
  assert.equal(parseNotification(splitRule, { title:'출금 75,000원', content:'입금자: 김철수' }), null);
});

test('잘못된 정규식과 필수값을 거부한다', () => {
  assert.throws(() => validateRuleInput({ ...rule, contentPattern:'(' }), /올바르지 않습니다/);
  assert.throws(() => validateRuleInput({ ...rule, contentPattern:'' }), /정규식/);
});
