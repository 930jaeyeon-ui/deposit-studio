import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDonation } from '@deposit-studio/shared';
import { hashPassword, verifyPassword } from '../src/password.js';

test('입금 입력을 정규화한다', () => {
  assert.deepEqual(normalizeDonation({ donorName: ' 폴조지 ', amount: '50000' }), {
    donorName: '폴조지', amount: 50000, bank: '테스트', externalId: null
  });
});

test('잘못된 금액을 거부한다', () => {
  assert.throws(() => normalizeDonation({ donorName: '폴조지', amount: 0 }), /금액/);
});

test('비밀번호는 원문 없이 해시로 검증한다', () => {
  const hash = hashPassword('Init1357!!');
  assert.equal(hash.includes('Init1357!!'), false);
  assert.equal(verifyPassword('Init1357!!', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});
