/**
 * check.mjs 감지 로직 시험 (네트워크·키 불필요).   실행: node watch/test/detect.mjs
 * 2026-08~10 「기준금리 변동 긴급」 이슈 9건 중 8건이 오탐이었던 원인을 재현한다.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, usable, diffRates, titleFor, LEAD_IDS } from '../detect.mjs';

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };
const D = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(readFileSync(join(D, '..', 'targets.json'), 'utf8')).targets;
const byId = Object.fromEntries(targets.map(t => [t.id, t]));
const chg = (id) => ({ ...byId[id], added: [1], removed: [] });
const T = '2026-10-08';

console.log('1) 이슈 제목 — 기준금리가 아닌 tier 1 변경에 「기준금리 변동」을 쓰지 않는다');
ok('한국은행 기준금리 변경 → 기준금리 변동 제목 (이슈 #4 같은 진짜 변경)', () => {
  assert.equal(titleFor([chg('bok_base_rate')], T), `🚨 기준금리 변동 감지 — CMA 표 전수 갱신 필요 (${T})`);
});
ok('한국증권금융 고시 변경 → 기준금리 변동 제목', () => {
  assert.match(titleFor([chg('ksfc_rate')], T), /^🚨 기준금리 변동 감지/);
});
ok('기준금리 + 발행어음이 같이 바뀌면 기준금리 제목', () => {
  assert.match(titleFor([chg('kis_bill'), chg('bok_base_rate')], T), /^🚨 기준금리 변동 감지/);
});
ok('발행어음·종금(한국투자·하나·KB·우리투자 RP)만 바뀌면 기준금리 문구 없음', () => {
  for (const id of ['kis_bill', 'hana_bill', 'kb_cma', 'wooriib_rp']) {
    const t = titleFor([chg(id)], T);
    assert.ok(!t.includes('기준금리'), id + ': ' + t);
    assert.match(t, /^🚨 발행어음·종금형 조달금리 변동 감지/);
  }
});
ok('tier 2 만 바뀌면 일반 제목', () => {
  assert.equal(titleFor([chg('sk'), chg('db')], T), `CMA 금리 변경 감지 2건 (${T})`);
});

console.log('2) 대상 분류');
ok('유안타는 자사 상품 파일이라 tier 2 (이슈 #1·2·3·5·9·15·16)', () => assert.equal(byId.yuanta.tier, 2));
ok('선행지표는 한국은행·한국증권금융 둘뿐이고 둘 다 tier 1', () => {
  assert.deepEqual([...LEAD_IDS].sort(), ['bok_base_rate', 'ksfc_rate']);
  for (const id of LEAD_IDS) assert.equal(byId[id].tier, 1);
});
ok('유안타만 바뀐 날(이슈 #15 재현)에는 긴급 라벨 대상(tier 1)이 없다', () => {
  const changed = [chg('yuanta')];
  assert.equal(changed.filter(c => c.tier === 1).length, 0);
  assert.equal(titleFor(changed, '2026-09-29'), 'CMA 금리 변경 감지 1건 (2026-09-29)');
});

console.log('3) 빈 응답 — 값이 전부 사라진 것으로 보지 않는다');
const yuantaLike = `ProdRate_CMA_rate = new Array('2.30','2.40'); ProdRate_CMARP_rate = new Array('2.60');
ProdRate_CMAMMW_prvt_rate = '2.87'; ProdRate_CMA_DPO_prvt_rate = '1.85'; ProdRate_CMAMMW_prvt_cmsn = '0.05';`;
ok('유안타형 데이터 파일에서 금리만 추출 (수수료 0.05 는 범위 밖)', () => {
  assert.deepEqual(fingerprint(yuantaLike), [1.85, 2.3, 2.4, 2.6, 2.87]);
});
ok('점검 화면·빈 JSON 은 수치 0개 → 사용 불가', () => {
  assert.equal(usable({ rates: fingerprint('<html><body>서비스 점검 중입니다</body></html>') }), false);
  assert.equal(usable({ rates: fingerprint('{}') }), false);
  assert.equal(usable({ error: 'HTTP 500' }), false);
  assert.equal(usable({ rates: [2.5] }), true);
});
ok('옛 동작 재현: 빈 값을 기준값으로 저장하면 다음 날 같은 값이 전부 「새로 생김」으로 잡힌다 (이슈 #2→#3)', () => {
  const normal = fingerprint(yuantaLike);
  const dayOfBlank = diffRates(normal, []);
  const dayAfter = diffRates([], normal);
  assert.deepEqual(dayOfBlank.removed, normal);   // 옛 코드가 이슈 #2 를 연 조건
  assert.deepEqual(dayAfter.added, normal);        // 이튿날 이슈 #3 을 연 조건
});
ok('새 동작: 빈 응답은 usable=false 라 check.mjs 가 이전 값을 유지 → 다음 날 비교는 변경 없음', () => {
  const normal = fingerprint(yuantaLike);
  const blank = { rates: [] };
  assert.equal(usable(blank), false);               // 기준값을 덮어쓰지 않음
  const next = diffRates(normal, fingerprint(yuantaLike));
  assert.deepEqual(next, { added: [], removed: [] });
});
ok('진짜 변경은 그대로 잡힌다 (SK 2.70→2.75)', () => {
  assert.deepEqual(diffRates([2.7, 2.8], [2.75, 2.8]), { added: [2.75], removed: [2.7] });
});

console.log('4) check.mjs 배선 — 같은 판정을 쓰는지');
ok('check.mjs 가 detect.mjs 의 함수를 쓰고 옛 하드코딩 제목이 없다', () => {
  const src = readFileSync(join(D, '..', 'check.mjs'), 'utf8');
  assert.match(src, /from '\.\/detect\.mjs'/);
  assert.match(src, /titleFor\(changed, today\)/);
  assert.match(src, /usable\(second\)/);
  assert.ok(!/const title = t1\.length/.test(src));
});

console.log(`\n통과 ${pass}건`);
