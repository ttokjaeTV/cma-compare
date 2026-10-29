/**
 * ai-update.mjs 시험 — 가짜 Claude 응답(mock.json)과 가짜 페이지(pages.json)로 돌린다.
 * API·git·gh 를 쓰지 않고 키도 필요 없다.   실행: node watch/test/run.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { readBrokers } from '../ai-update.mjs';

const T = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(T, '..', 'ai-update.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'ai-test-'));
let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name); };

function run(args, env = {}) {
  const e = { ...process.env, ANTHROPIC_API_KEY: '', GH_TOKEN: '', ISSUE_NUMBER: '', ...env };
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: e });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

try {
  // CRLF 보존 확인을 위해 샘플을 CRLF 로 바꿔서 쓴다
  const lf = readFileSync(join(T, 'index.sample.html'), 'utf8').replace(/\r\n/g, '\n');
  const idx = join(tmp, 'index.html');
  writeFileSync(idx, lf.replace(/\n/g, '\r\n'));
  const outDir = join(tmp, 'out');

  console.log('1) 가짜 응답으로 dry-run');
  const r1 = run(['--dry-run', '--mock', join(T, 'mock.json'), '--pages', join(T, 'pages.json'), '--index', idx, '--out', outDir, '--today', '2026-10-29', '--issue', '77']);
  assert.equal(r1.code, 0, r1.out);
  const res = JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8'));
  const patched = readFileSync(join(outDir, 'index.html'), 'utf8');
  const before = readBrokers(readFileSync(idx, 'utf8'));
  const after = readBrokers(patched);
  const by = (list, id) => list.find(b => b.id === id);

  ok('정상 변경 4건만 수정 (한국투자 발행어음 · KB RP · 하나 RP · 우리투자 RP)', () => {
    assert.deepEqual(res.edits.map(e => e.key).sort(), ['hana.rp', 'koreainv.bill', 'kb.rp', 'wooriib.rp'].sort());
  });
  ok('한국투자 발행어음 2.85→3.05, 적용일 2026-10-20', () => {
    assert.equal(by(before, 'koreainv').bill.r, 2.85);
    assert.equal(by(after, 'koreainv').bill.r, 3.05);
    assert.equal(by(after, 'koreainv').bill.d, '2026-10-20');
  });
  ok('KB RP 2.50→2.55, 하나 RP 2.55→2.60 (같은 증권사 발행어음 보류와 섞이지 않음)', () => {
    assert.equal(by(after, 'kb').rp.r, 2.55);
    assert.equal(by(after, 'kb').rp.d, '2026-10-27');
    assert.equal(by(after, 'hana').rp.r, 2.6);
    assert.equal(by(after, 'hana').bill.r, by(before, 'hana').bill.r);   // hana_bill 은 보류 → 그대로
    assert.equal(by(after, 'kb').bill.r, by(before, 'kb').bill.r);       // 조건부 금리 → 그대로
  });
  ok('적용일 없는 응답은 확인일(--today)로 넣고 주의 문구를 남김', () => {
    assert.equal(by(after, 'wooriib').rp.r, 2.9);
    assert.equal(by(after, 'wooriib').rp.d, '2026-10-29');
    assert.match(res.edits.find(e => e.key === 'wooriib.rp').dateNote, /직접 확인/);
  });
  ok('수정한 r·d 외에는 모든 필드가 그대로 (객체 전체 비교)', () => {
    const touched = { 'koreainv.bill': 1, 'kb.rp': 1, 'hana.rp': 1, 'wooriib.rp': 1 };
    const strip = (list) => JSON.parse(JSON.stringify(list)).map(b => {
      for (const p of ['rp', 'bill']) if (touched[`${b.id}.${p}`]) { delete b[p].r; delete b[p].d; }
      return b;
    });
    assert.deepEqual(strip(after), strip(before));
  });
  ok('바뀐 줄은 4개 증권사 줄뿐이고 CRLF 가 그대로', () => {
    const a = readFileSync(idx, 'utf8').split('\r\n');
    const b = patched.split('\r\n');
    assert.equal(a.length, b.length);
    assert.equal(patched.split('\n').length, patched.split('\r\n').length);   // 맨 \n 이 하나도 없음
    const diff = a.map((l, i) => (l === b[i] ? null : i)).filter(i => i !== null);
    assert.equal(diff.length, 4, '바뀐 줄: ' + diff.join(','));
  });
  ok('보류 9건과 이유', () => {
    const h = Object.fromEntries(res.holds.map(x => [x.label, x.reason]));
    assert.equal(res.holds.length, 9, JSON.stringify(res.holds, null, 1));
    const find = (k) => res.holds.find(x => x.label.includes(k))?.reason || '';
    assert.match(find('KB증권 CMA 금리 JSON · KB증권 발행어음'), /기본 금리가 아닌/);
    assert.match(find('SK증권'), /변동/);                       // 2.70 → 5.10
    assert.match(find('DB증권'), /신뢰도 낮음/);
    assert.match(find('대신증권'), /JSON 파싱 실패/);
    assert.match(find('IBK'), /글자 그대로 없음/);
    assert.match(find('상상인증권'), /비정상 범위/);             // 0%
    assert.match(find('유안타'), /비정상 범위/);                 // 12.5%
    assert.match(find('신한'), /새 금리 2\.60 가 들어 있지 않음/);
    assert.match(find('하나증권 발행어음'), /과거인데 금리가 다름/);
    void h;
  });
  ok('PR 본문: 이전→이후, 근거, 출처, 이슈 번호, 보류 목록, 자동 병합 없음 문구', () => {
    const body = readFileSync(join(outDir, 'pr-body.md'), 'utf8');
    assert.match(body, /2\.85% → \*\*3\.05%\*\*/);
    assert.match(body, /`2026-10-20 적용 연 3\.05% \(세전, 31일 재투자\)`/);
    assert.match(body, /\(https:\/\/example\.test\/kis\)/);
    assert.match(body, /이슈 #77/);
    assert.match(body, /자동 병합되지 않습니다/);
    assert.match(body, /이번에 보류한 항목/);
  });
  ok('보류 댓글 본문이 「AI 추출 보류」로 시작', () => {
    const c = readFileSync(join(outDir, 'issue-comment.md'), 'utf8');
    assert.ok(c.startsWith('AI 추출 보류'));
  });
  ok('지표 대상(한국은행 기준금리)은 AI 수정 대상이 아니라는 로그', () => {
    assert.match(r1.out, /한국은행 기준금리: AI 수정 대상 아님/);
  });

  console.log('2) 키 없음');
  const r2 = run(['--pages', join(T, 'pages.json'), '--index', idx]);
  ok('API 키가 없으면 조용히 건너뜀(종료코드 0, 아무것도 만들지 않음)', () => {
    assert.equal(r2.code, 0);
    assert.match(r2.out, /건너뜀/);
    assert.ok(!/Claude 호출|PR 생성/.test(r2.out));
  });

  console.log('3) 변경 없음');
  const r3 = run(['--dry-run', '--mock', join(T, 'mock.json'), '--pages', join(tmp, 'none.json'), '--index', idx]);
  ok('changed-pages.json 이 없으면 아무 일 없이 종료', () => {
    assert.equal(r3.code, 0);
    assert.match(r3.out, /할 일 없음/);
  });

  console.log('4) 요청 본문');
  const r4 = run(['--dry-run', '--show-prompt', '--pages', join(T, 'pages.json'), '--index', idx]);
  ok('모델·thinking·구조화 출력 설정이 들어가고 키는 어디에도 없음', () => {
    assert.match(r4.out, /"model": "claude-sonnet-5-5"/);
    assert.match(r4.out, /"type": "between_tools"/);
    assert.match(r4.out, /"type": "json_schema"/);
    assert.ok(!/"temperature"|"top_p"|"top_k"/.test(r4.out));
  });

  console.log('5) 본문 줄이기·수정 함수');
  const { excerpt, patchSlot } = await import('../ai-update.mjs');
  ok('긴 본문은 8천 자 안팎으로 줄이되, 새로 나타난 값이 든 구간은 반드시 남김', () => {
    const filler = '가나다라마바사 '.repeat(2000);                       // 약 14,000자, 금리 숫자 없음
    const text = filler + '구간A 연 2.10% ' + filler + '구간B 연 3.33% 신규 ' + filler + '구간C 연 2.20% ' + filler;
    const ex = excerpt(text, [3.33]);
    assert.ok(text.length > 50000);
    assert.ok(ex.length <= 8300, '길이 ' + ex.length);
    assert.ok(ex.includes('구간B 연 3.33% 신규'));
  });
  ok('짧은 본문은 그대로', () => assert.equal(excerpt('연 2.5% 입니다', [2.5]), '연 2.5% 입니다'));
  ok('없는 증권사·상품은 던지고 원문은 건드리지 않음', () => {
    const s = readFileSync(idx, 'utf8');
    assert.throws(() => patchSlot(s, 'nobody', 'rp', 2.5, '2026-10-29'), /찾지 못함/);
    assert.throws(() => patchSlot(s, 'sk', 'bill', 2.5, '2026-10-29'), /찾지 못함|객체/);   // sk 는 발행어음 없음(bill:false)
  });
  ok('d 가 null 인 항목(상상인증권)도 날짜를 넣을 수 있음', () => {
    const s = patchSlot(readFileSync(idx, 'utf8'), 'sangsangin', 'rp', 2.8, '2026-10-29');
    const b = readBrokers(s).find(x => x.id === 'sangsangin');
    assert.equal(b.rp.r, 2.8); assert.equal(b.rp.d, '2026-10-29');
  });

  console.log(`\n통과 ${pass}건`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (existsSync(join(T, 'out'))) console.log('경고: watch/test/out 가 남아 있음');
