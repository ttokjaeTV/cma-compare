/**
 * CMA 금리 변경 감시
 *
 * 각 페이지의 "숫자 지문"(금리로 보이는 수치 집합)을 뽑아 이전과 비교한다.
 * HTML 구조를 파싱하지 않으므로 마크업이 바뀌어도 잘 깨지지 않는다.
 *
 * 감지만 한다. 표를 자동으로 고치지 않는다 —
 * 갱신되지 않은 값이 남아 있는 페이지, 배너와 금리표가 어긋나는 페이지가 실재하므로
 * 자동 갱신하면 틀린 숫자가 그대로 공개된다.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { constants } from 'node:crypto';

const DIR = dirname(fileURLToPath(import.meta.url));
const TARGETS = JSON.parse(readFileSync(join(DIR, 'targets.json'), 'utf8')).targets;
const BASE_PATH = join(DIR, 'baseline.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT = 20000;

/** 금리로 볼 수 있는 수치만 추출 */
function fingerprint(text, mode) {
  const plain = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const nums = plain.match(/(?<![\d.])[0-9]\.[0-9]{1,2}(?![\d])/g) || [];
  // 금리 범위 밖(0.5 미만, 8 초과)은 버전번호·비율 등 노이즈일 가능성이 커서 제외
  const rates = nums.map(Number).filter(n => n >= 0.5 && n <= 8);
  // mode:'first' — 과거 이력이 함께 실린 표(한국은행 추이표)는 문서 첫 값만 본다.
  // 집합으로 비교하면 과거에 나왔던 금리로 인상될 때 변화를 못 잡는다.
  if (mode === 'first') return rates.length ? [rates[0]] : [];
  return [...new Set(rates)].sort((a, b) => a - b);
}

/** 구형 TLS 재협상만 허용하는 서버(우리투자증권)용 폴백 */
function legacyGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
      rejectUnauthorized: false,
      timeout: TIMEOUT,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('타임아웃')));
  });
}

async function grab(t) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    if (t.legacyTls) {
      const r = await legacyGet(t.url);
      if (r.status !== 200) return { error: `HTTP ${r.status}` };
      let text;
      try { text = new TextDecoder(t.encoding || 'utf-8').decode(r.buf); }
      catch { text = r.buf.toString('utf8'); }
      return { rates: fingerprint(text, t.mode), bytes: r.buf.length };
    }
    const res = await fetch(t.url, {
      method: t.method || 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/json,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        ...(t.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        // t.headers — Referer·X-Requested-With를 요구하는 엔드포인트(한국증권금융 등)
        ...(t.headers || {}),
      },
      // t.body — form-urlencoded 본문. 없으면 기존처럼 빈 본문
      body: t.method === 'POST' ? (t.body || '') : undefined,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    let enc = t.encoding;
    if (!enc) {
      const ct = res.headers.get('content-type') || '';
      const m = ct.match(/charset=([\w-]+)/i);
      enc = m ? m[1].toLowerCase() : 'utf-8';
      if (enc === 'utf-8') {
        const head = buf.subarray(0, 2048).toString('latin1');
        if (/charset=["']?(euc-kr|ks_c_5601)/i.test(head)) enc = 'euc-kr';
      }
    }
    let text;
    try { text = new TextDecoder(enc).decode(buf); }
    catch { text = buf.toString('utf8'); }
    return { rates: fingerprint(text, t.mode), bytes: buf.length };
  } catch (e) {
    return { error: e.name === 'AbortError' ? '타임아웃' : String(e.message || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

const base = existsSync(BASE_PATH) ? JSON.parse(readFileSync(BASE_PATH, 'utf8')) : { targets: {} };
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const today = kst.toISOString().slice(0, 10);              // 2026-08-19
const now = `${today} ${kst.toISOString().slice(11, 16)} KST`;

const next = { checked_at: now, targets: {} };
const changed = [];
const errors = [];

/**
 * 일시적 실패 재시도.
 * NH 본사 페이지처럼 연속 호출 시 빈 응답을 주는 곳, 간헐적 네트워크 실패가 실재한다.
 * 2026-09-18 실측: 하나·신한·KB해외·유진이 리포트에 fetch failed로 찍혔으나 모두 URL은 정상이었다.
 * 헛알림(=조사자가 멀쩡한 페이지를 뒤지게 만드는 비용)을 줄이기 위해 한 번 더 시도한다.
 */
async function grabWithRetry(t) {
  const first = await grab(t);
  const failed = first.error || (first.rates && first.rates.length === 0);
  if (!failed) return first;
  await new Promise(r => setTimeout(r, 4000));
  const second = await grab(t);
  const stillFailed = second.error || (second.rates && second.rates.length === 0);
  if (!stillFailed) console.log(`  ↻ ${t.label} — 재시도 성공`);
  return second;
}

for (const t of TARGETS) {
  const r = await grabWithRetry(t);
  const prev = base.targets?.[t.id];

  if (r.error) {
    errors.push({ ...t, error: r.error });
    // 실패 시 이전 값을 보존해 다음 실행에서 헛알림이 나지 않게 한다
    next.targets[t.id] = prev ?? { rates: [], never_seen: true };
    console.log(`✗ ${t.label} — ${r.error}`);
    continue;
  }

  next.targets[t.id] = { rates: r.rates, checked_at: now };

  if (prev?.rates) {
    const a = new Set(prev.rates), b = new Set(r.rates);
    const added = r.rates.filter(x => !a.has(x));
    const removed = prev.rates.filter(x => !b.has(x));
    if (added.length || removed.length) {
      changed.push({ ...t, added, removed });
      console.log(`● ${t.label} — 변경 (+${added.join(',')} / -${removed.join(',')})`);
    } else {
      console.log(`· ${t.label} — 그대로`);
    }
  } else {
    console.log(`+ ${t.label} — 최초 수집 (${r.rates.length}개 수치)`);
  }
}

writeFileSync(BASE_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8');

/* ── 리포트 ── */
const t1 = changed.filter(c => c.tier === 1);
const lines = [];

if (t1.length) {
  // tier 1은 두 갈래다 — 지표(기준금리·고시금리)와 발행어음·종금 조달금리.
  // 2026-09 실측: 기준금리가 그대로여도 발행어음·종금형은 따로 움직였다.
  const LEAD = new Set(['bok_base_rate', 'ksfc_rate']);
  const lead = t1.filter(c => LEAD.has(c.id));
  const fund = t1.filter(c => !LEAD.has(c.id));

  if (lead.length) {
    lines.push('## 🚨 기준금리·증권금융 고시가 바뀌었습니다', '');
    lines.push('**2~4영업일 내 전 증권사 RP형·MMW형이 따라 움직입니다. 전수 갱신을 준비하세요.**', '');
    lines.push('> ⚠ 한국증권금융은 「수시입출식」과 「거치식」을 따로 고시합니다.', '');
    lines.push('> 이 감시는 수시입출식(증권사 CMA-MMW의 기초)을 봅니다. 거치식만 바뀐 경우 MMW는 움직이지 않습니다.', '');
  }
  if (fund.length) {
    lines.push('## 🚨 발행어음·종금형 조달금리가 바뀌었습니다', '');
    lines.push('**금통위와 무관하게 각 사가 자체적으로 올리고 내리는 구간입니다.**', '');
    lines.push('해당 증권사부터 확인하고, 같은 시기에 다른 발행어음 취급사도 움직였는지 함께 보세요 — 2026-09에 한국투자(9/4)·하나(9/7)·우리투자(9/3·9/10)가 순차적으로 올랐습니다.', '');
  }
}
if (changed.length) {
  lines.push('## 변경 감지', '');
  lines.push('| 대상 | 새로 생긴 값 | 사라진 값 |', '|---|---|---|');
  for (const c of changed) {
    lines.push(`| ${c.tier === 1 ? '🚨 ' : ''}[${c.label}](${c.url}) | ${c.added.join(', ') || '–'} | ${c.removed.join(', ') || '–'} |`);
  }
  lines.push('');
  lines.push('> 숫자 지문 비교라 **오탐이 있을 수 있습니다.** 링크를 열어 실제 금리와 기준일을 직접 확인하세요.');
  lines.push('> 페이지 표시값이 최신이 아닌 경우가 있으니, 공지·고시로 교차 확인하세요. (상세는 로컬 갱신가이드 3장)', '');
}
if (errors.length) {
  lines.push('## 수집 실패', '');
  for (const e of errors) lines.push(`- ${e.label} — ${e.error}`);
  lines.push('');
  lines.push('> 실패한 대상은 이전 값을 유지했습니다. 반복되면 URL이 바뀐 것일 수 있습니다.', '');
}
if (!changed.length && !errors.length) lines.push(`변경 없음 · ${now}`);

lines.push('---');
lines.push('감시 대상은 전체가 아닙니다. 제외된 곳은 이 알림에 잡히지 않으니, 로컬 갱신가이드 3-2장의 제외 목록을 함께 확인하세요.');

const report = lines.join('\n');
writeFileSync(join(DIR, 'report.md'), report + '\n', 'utf8');

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n', { flag: 'a' });
}
if (process.env.GITHUB_OUTPUT) {
  const title = t1.length
    ? `🚨 기준금리 변동 감지 — CMA 표 전수 갱신 필요 (${today})`
    : `CMA 금리 변경 감지 ${changed.length}건 (${today})`;
  writeFileSync(process.env.GITHUB_OUTPUT,
    `changed=${changed.length > 0}\ntier1=${t1.length > 0}\ntitle=${title}\n`, { flag: 'a' });
}

console.log(`\n총 ${TARGETS.length}곳 · 변경 ${changed.length} · 실패 ${errors.length}`);
