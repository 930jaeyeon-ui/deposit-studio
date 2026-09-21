import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToonationPayload, toonationWidgetKey } from '../src/toonation.js';

test('투네이션 위젯 주소에서 키를 추출한다', () => {
  assert.equal(toonationWidgetKey('https://toon.at/widget/alertbox/abcdefgh'), 'abcdefgh');
  assert.equal(toonationWidgetKey('abcdefgh'), 'abcdefgh');
  assert.equal(toonationWidgetKey('https://example.com/widget/alertbox/abcdefgh'), '');
});

test('투네이션 후원 메시지를 파싱한다', () => {
  const raw = JSON.stringify({ content:JSON.stringify({ name:'홍길동', amount:'50,000', message:'응원합니다', title_info:{ name:'다이아' } }) });
  assert.deepEqual(parseToonationPayload(raw), { donorName:'홍길동', amount:50000, message:'응원합니다', grade:'다이아' });
  assert.equal(parseToonationPayload('#ping'), null);
});
