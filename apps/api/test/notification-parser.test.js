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

test('잘못된 정규식과 필수값을 거부한다', () => {
  assert.throws(() => validateRuleInput({ ...rule, contentPattern:'(' }), /올바르지 않습니다/);
  assert.throws(() => validateRuleInput({ ...rule, contentPattern:'' }), /정규식/);
});
