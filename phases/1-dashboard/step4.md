# Step 4: dashboard-aggregate

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL: 금액 합계와 통계는 반드시 코드로 계산한다)
- `/docs/PRD.md` (요금제 표, 디자인: 금액 표기)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-007, ADR-011, ADR-015)
- `/scripts/tdd_guard.py`
- `/src/types/transaction.ts`, `/src/lib/transactions/categories.ts` (step 0 산출물)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

대시보드가 쓰는 계산을 순수 함수로 만든다: 조회 기간, 합계와 카테고리별 집계, 금액·날짜 표기. DB 조회와 화면은 이 step에서 만들지 않는다.

구현 파일보다 테스트 파일을 먼저 작성하라.

### 1. 타입 (`src/types/dashboard.ts`)

```ts
// 양 끝 날짜를 포함하는 기간. 둘 다 "YYYY-MM-DD".
export type DateRange = { from: string; to: string };

export type CategoryTotal = {
  category: Category;
  amount: number; // 원 단위 정수, 항상 양수
  ratio: number; // 0~1. categories에 실린 금액의 합에 대한 비율
};

export type DashboardSummary = {
  totalExpense: number; // 이체를 뺀 지출의 합
  totalIncome: number;
  totalTransfer: number; // 이체의 합. totalExpense에 들어 있지 않다.
  categories: CategoryTotal[]; // 이체를 뺀 지출만, 금액이 큰 순
};
```

### 2. 조회 기간 (`src/lib/dashboard/period.ts`)

```ts
// 가장 최근 거래일을 끝으로 하는 최근 1개월.
export function recentMonthRange(latestDate: string): DateRange;
```

- `to`는 `latestDate`다.
- `from`은 `latestDate`의 한 달 전 날짜의 **다음 날**이다. 한 달 전에 같은 날이 없으면 그 달의 말일로 당긴 뒤 하루를 더한다.

| latestDate | from | to |
|---|---|---|
| 2026-09-13 | 2026-08-14 | 2026-09-13 |
| 2026-01-15 | 2025-12-16 | 2026-01-15 |
| 2026-03-31 | 2026-03-01 | 2026-03-31 |
| 2026-03-30 | 2026-03-01 | 2026-03-30 |
| 2024-03-29 | 2024-03-01 | 2024-03-29 |
| 2026-10-31 | 2026-10-01 | 2026-10-31 |
| 2026-03-01 | 2026-02-02 | 2026-03-01 |

- 오늘 날짜(`new Date()`, `Date.now()`)를 쓰지 마라. 이유: 기준은 저장된 거래의 최근 날짜다 (ADR-011).
- 날짜 계산은 UTC 기준으로만 하라(`Date.UTC`, `getUTC*`). 이유: 로컬 시간대 메서드를 쓰면 서버 시간대에 따라 하루가 밀린다.

### 3. 집계 (`src/lib/dashboard/summarize.ts`)

```ts
export function summarize(
  transactions: readonly Pick<CategorizedTransaction, "amount" | "kind" | "category">[],
): DashboardSummary;
```

- `totalExpense`는 `kind`가 `expense`이고 `category`가 `TRANSFER_CATEGORY`가 아닌 거래의 `amount` 합이다. 음수(취소·환불)는 합계를 줄인다.
- `totalTransfer`는 `kind`가 `expense`이고 `category`가 `TRANSFER_CATEGORY`인 거래의 `amount` 합이다. 이 거래들은 `totalExpense`에 넣지 않는다. 이유: `이체`에는 본인 계좌 사이의 이동과 카드 대금 결제가 들어 있다. 지출로 세면 카드 명세서와 그 대금이 빠져나간 은행 내역을 함께 올렸을 때 같은 소비가 두 번 잡힌다 (ADR-015).
- `totalIncome`은 `kind`가 `income`인 거래의 `amount` 합이다.
- `categories`는 `category`가 `TRANSFER_CATEGORY`가 아닌 지출 거래만 카테고리별로 더한 것이다. 합이 0 이하인 카테고리는 뺀다.
- 정렬은 금액이 큰 순이다. 금액이 같으면 `MERCHANT_CATEGORIES`의 순서를 따른다.
- `ratio`는 그 카테고리 금액을 `categories`에 실린 금액의 합으로 나눈 값이다. 실린 것이 없으면 `categories`는 빈 배열이다.
- 입력이 비어 있으면 `{ totalExpense: 0, totalIncome: 0, totalTransfer: 0, categories: [] }`.
- 합계는 정수 덧셈으로만 계산하라.

### 4. 표기 (`src/lib/format.ts`)

```ts
export function formatWon(amount: number): string; // 1234000 → "1,234,000원", -4500 → "-4,500원", 0 → "0원"
export function formatDate(date: string): string; // "2026-09-01" → "2026.09.01"
```

- `formatWon`은 `Intl.NumberFormat("ko-KR")`처럼 로케일을 명시해서 쓴다. 로케일 없는 `toLocaleString()`을 쓰지 마라. 이유: 실행 환경의 기본 로케일에 따라 결과가 달라진다.
- `formatDate`는 문자열을 잘라 조립한다. `Date`로 바꾸지 마라.

### 5. 테스트

- 세 테스트 파일 모두 첫 줄에 `// @vitest-environment node`를 둔다.
- `period.test.ts`: 위 표의 모든 행.
- `summarize.test.ts`:
  - 지출과 수입이 섞인 입력의 두 합계
  - `이체` 거래의 금액은 `totalTransfer`에 더해지고 `totalExpense`에는 들어가지 않는다. `categories`에 `이체`가 없다
  - 환불(음수 지출)이 `totalExpense`와 해당 카테고리 금액을 줄인다
  - 합이 0 이하인 카테고리는 `categories`에 없다
  - 수입 거래는 `categories`에 없다
  - 정렬과 동률 처리
  - `ratio`의 합이 1이다 (부동소수 오차는 `toBeCloseTo`)
  - 빈 입력은 `{ totalExpense: 0, totalIncome: 0, totalTransfer: 0, categories: [] }`
- `format.test.ts`: 위 주석의 예시들.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
npm run test
TZ=America/Los_Angeles npx vitest run src/lib/dashboard src/lib/format.test.ts
TZ=Asia/Seoul npx vitest run src/lib/dashboard src/lib/format.test.ts
test -f src/lib/dashboard/period.test.ts && test -f src/lib/dashboard/summarize.test.ts && test -f src/lib/format.test.ts
grep -q "totalTransfer" src/types/dashboard.ts && grep -q "totalTransfer" src/lib/dashboard/summarize.ts
! grep -n "Date.now()\|new Date()" src/lib/dashboard/period.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (파일 경로, 함수 시그니처, 기간 계산 규칙, `이체`가 `totalExpense`가 아니라 `totalTransfer`에 들어간다는 것을 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 월별 추이, 전월 대비 증감, 가맹점 TOP 랭킹, 정기결제 탐지를 만들지 마라. 이유: Pro 기능이고 Phase 2 범위다.
- 플랜에 따라 기간을 바꾸는 인자나 분기를 넣지 마라. 이유: 플랜 정보는 Phase 2에서 생긴다. 지금은 모든 사용자가 최근 1개월이다.
- 날짜 라이브러리(date-fns, dayjs 등)를 설치하지 마라. 이유: 필요한 계산이 함수 하나다.
- DB 조회 코드나 React 컴포넌트를 만들지 마라. 이유: step 7, 9 범위다.
- 기존 테스트를 깨뜨리지 마라.
