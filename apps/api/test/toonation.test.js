import test from 'node:test';
import assert from 'node:assert/strict';
import { parseToonationPayload, toonationWidgetKey } from '../src/toonation.js';

test('투네이션 위젯 주소에서 키를 추출한다', () => {
  assert.equal(toonationWidgetKey('https://toon.at/widget/alertbox/abcdefgh'), 'abcdefgh');
  assert.equal(toonationWidgetKey('https://toon.at/widget/alertbox/abcdefgh?source=obs#alert'), 'abcdefgh');
  assert.equal(toonationWidgetKey('https://www.toon.at/widget/alertbox/abcdefgh/'), 'abcdefgh');
  assert.equal(toonationWidgetKey('https://toon.at/widget/alertbox/abcdefgh/101'), 'abcdefgh');
  assert.equal(toonationWidgetKey('abcdefgh'), 'abcdefgh');
  assert.equal(toonationWidgetKey('https://example.com/widget/alertbox/abcdefgh'), '');
});

test('투네이션 후원 메시지를 파싱한다', () => {
  const raw = JSON.stringify({ content:JSON.stringify({ name:'홍길동', amount:'50,000', message:'응원합니다', title_info:{ name:'다이아' } }) });
  assert.deepEqual(parseToonationPayload(raw), { donorName:'홍길동', amount:50000, message:'응원합니다', grade:'다이아', eventKey:'395918ba9aac5071e23dc009b0a18d08' });
  const identified = value => parseToonationPayload(JSON.stringify({ content:JSON.stringify({ id:value, name:'홍길동', amount:50000, message:'응원합니다' }) })).eventKey;
  assert.equal(identified('event-1'),identified('event-1'));
  assert.notEqual(identified('event-1'),identified('event-2'));
  assert.equal(parseToonationPayload('#ping'), null);
});
