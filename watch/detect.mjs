/**
 * check.mjs 의 판정 로직 중 네트워크가 필요 없는 순수 함수 모음 (시험 가능하게 분리).
 * 동작은 check.mjs 에서 옮겨 온 그대로이고, 아래 두 가지만 새로 정했다.
 *   - usable(): 수치가 0개인 응답은 "값이 전부 사라짐"이 아니라 수집 실패로 본다.
 *   - titleFor(): 이슈 제목의 「기준금리 변동」은 기준금리·증권금융 고시가 바뀐 때만 쓴다.
 */

/** 태그를 걷어낸 본문 */
export function stripTags(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

/** 금리로 볼 수 있는 수치만 추출 */
export function fingerprint(text, mode) {
  const plain = stripTags(text);
  const nums = plain.match(/(?<![\d.])[0-9]\.[0-9]{1,2}(?![\d])/g) || [];
  // 금리 범위 밖(0.5 미만, 8 초과)은 버전번호·비율 등 노이즈일 가능성이 커서 제외
  const rates = nums.map(Number).filter(n => n >= 0.5 && n <= 8);
  // mode:'first' — 과거 이력이 함께 실린 표(한국은행 추이표)는 문서 첫 값만 본다.
  if (mode === 'first') return rates.length ? [rates[0]] : [];
  return [...new Set(rates)].sort((a, b) => a - b);
}

/** 전 증권사가 따라 움직이는 선행지표 (기준금리·증권금융 수시입출식 고시) */
export const LEAD_IDS = new Set(['bok_base_rate', 'ksfc_rate']);

/**
 * 수집 결과가 비교에 쓸 수 있는지.
 * 오류이거나 금리 수치가 0개면 쓸 수 없다. 0개인 응답(점검 중 화면·빈 JSON·렌더 실패)을
 * 그대로 기준값으로 저장하면, 다음 날 정상 응답이 "전부 새로 생김"으로 잡혀 이슈가 두 번 열린다.
 * (2026-08-24 유안타, 09-12 우리투자 종금형 2곳, 09-19 SK 실제 사례)
 */
export function usable(r) {
  return !r.error && Array.isArray(r.rates) && r.rates.length > 0;
}

/** 이전 수치와 비교 */
export function diffRates(prevRates, rates) {
  const a = new Set(prevRates), b = new Set(rates);
  return {
    added: rates.filter(x => !a.has(x)),
    removed: prevRates.filter(x => !b.has(x)),
  };
}

/** 이슈 제목. t1 은 변경된 tier 1 대상 목록 */
export function titleFor(changed, today) {
  const t1 = changed.filter(c => c.tier === 1);
  if (!t1.length) return `CMA 금리 변경 감지 ${changed.length}건 (${today})`;
  if (t1.some(c => LEAD_IDS.has(c.id))) return `🚨 기준금리 변동 감지 — CMA 표 전수 갱신 필요 (${today})`;
  return `🚨 발행어음·종금형 조달금리 변동 감지 — 해당 증권사 확인 필요 (${today})`;
}
