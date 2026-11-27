## 🚨 기준금리·증권금융 고시가 바뀌었습니다

**2~4영업일 내 전 증권사 RP형·MMW형이 따라 움직입니다. 전수 갱신을 준비하세요.**

> ⚠ 한국증권금융은 「수시입출식」과 「거치식」을 따로 고시합니다.

> 이 감시는 수시입출식(증권사 CMA-MMW의 기초)을 봅니다. 거치식만 바뀐 경우 MMW는 움직이지 않습니다.

## 🚨 발행어음·종금형 조달금리가 바뀌었습니다

**금통위와 무관하게 각 사가 자체적으로 올리고 내리는 구간입니다.**

해당 증권사부터 확인하고, 같은 시기에 다른 발행어음 취급사도 움직였는지 함께 보세요 — 2026-09에 한국투자(9/4)·하나(9/7)·우리투자(9/3·9/10)가 순차적으로 올랐습니다.

## 변경 감지

| 대상 | 새로 생긴 값 | 사라진 값 |
|---|---|---|
| 🚨 [한국증권금융 수시입출식 고시금리](https://www.ksfc.co.kr:4443/product/rate/ajax/getDepositExpireAndRate.do) | 2.93 | 2.68 |
| [유안타증권 금리 데이터](https://www.myasset.com/myasset/code/prodRate.tbl) | 3.05, 3.07 | 2.6, 2.8, 2.82, 2.87 |
| 🚨 [하나증권 발행어음](https://www.hanaw.com/main/finance/drownBill/NS_010100_P1S1.cmd) | 2.75, 3.1, 3.4, 3.45, 3.8, 3.85, 4.15, 4.2, 4.65 | 2.65, 3, 3.25, 3.3, 3.65, 3.7, 4, 4.35 |
| [하나증권 CMA (RP·MMW)](https://www.hanaw.com/main/finance/CMA/FP_040101_P.cmd) | 3.05, 3.12 | 2.55, 2.87 |
| [신한투자증권 CMA 실시간](https://www.shinhansec.com/siw/wealth-management/cma/info/data.do) | 2.7, 2.85, 3.05, 3.12 | 2.45, 2.6, 2.8, 2.87 |
| [SK증권 CMA 금리 API](https://www.sks.co.kr/main/product/rp/MAGIC_CMA_DATA_Q.cmd) | 2.95, 3.05, 3.15 | 2.7, 2.8, 2.9 |
| [IBK투자증권 CMA 금리](https://www.ibks.com/fundproduct/cma/cmaservice_Rate.do) | 2.95 | 2.75 |
| [상상인증권 CMA](https://www.sangsanginib.com/info/cmaView) | 3 | 2.75 |

> 숫자 지문 비교라 **오탐이 있을 수 있습니다.** 링크를 열어 실제 금리와 기준일을 직접 확인하세요.
> 페이지 표시값이 최신이 아닌 경우가 있으니, 공지·고시로 교차 확인하세요. (상세는 로컬 갱신가이드 3장)

## 수집 실패

- DB증권 CMA 금리 API — fetch failed

> 실패한 대상은 이전 값을 유지했습니다. 반복되면 URL이 바뀐 것일 수 있습니다.

---
감시 대상은 전체가 아닙니다. 제외된 곳은 이 알림에 잡히지 않으니, 로컬 갱신가이드 3-2장의 제외 목록을 함께 확인하세요.
