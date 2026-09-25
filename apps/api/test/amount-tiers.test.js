import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTtsWordReplacements, normalizeTtsWordReplacements, validateAmountTiers } from '@deposit-studio/shared';

test('서로 떨어진 금액 구간과 맞닿지 않은 경계를 허용한다', () => {
  assert.doesNotThrow(() => validateAmountTiers([
    { minAmount:0, maxAmount:99999 },
    { minAmount:100000, maxAmount:499999 },
    { minAmount:500000, maxAmount:null },
  ]));
});

test('최소 금액보다 작은 최대 금액을 거부한다', () => {
  assert.throws(
    () => validateAmountTiers([{ minAmount:100000, maxAmount:99999 }]),
    /최대 금액은 최소 금액보다 크거나 같아야/,
  );
});

test('경계 금액을 포함해 겹치는 구간을 거부한다', () => {
  assert.throws(
    () => validateAmountTiers([
      { minAmount:0, maxAmount:100000 },
      { minAmount:100000, maxAmount:200000 },
    ]),
    /서로 겹치지 않게/,
  );
});

test('제한 없는 구간 뒤의 추가 구간을 거부한다', () => {
  assert.throws(
    () => validateAmountTiers([
      { minAmount:0, maxAmount:null },
      { minAmount:100000, maxAmount:200000 },
    ]),
    /서로 겹치지 않게/,
  );
});

test('금액 구간은 최대 12개까지만 허용한다', () => {
  const tiers = Array.from({ length:13 }, (_, index) => ({
    minAmount:index * 1000,
    maxAmount:index * 1000 + 999,
  }));
  assert.throws(() => validateAmountTiers(tiers), /최대 12개/);
});

test('TTS 금지 단어를 긴 단어부터 한 번만 안전하게 치환한다', () => {
  const rules = normalizeTtsWordReplacements([
    { source:'나쁜 말', replacement:'좋은 말' },
    { source:'나쁜', replacement:'예쁜' },
    { source:'a+b', replacement:'수식' },
  ]);
  assert.equal(applyTtsWordReplacements('나쁜 말, 나쁜 표현, A+B', rules), '좋은 말, 예쁜 표현, 수식');
});

test('빈 값과 중복 금지 단어를 거부한다', () => {
  assert.throws(() => normalizeTtsWordReplacements([{ source:'', replacement:'대체' }]), /모두 입력/);
  assert.throws(() => normalizeTtsWordReplacements([{ source:'TEST', replacement:'하나' },{ source:'test', replacement:'둘' }]), /중복/);
});
