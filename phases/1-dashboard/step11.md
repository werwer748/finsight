# Step 11: sample-demo

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (핵심 기능 7: 가입 없이 가상 데이터로 대시보드를 보는 샘플 체험)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/scripts/tdd_guard.py`
- `/src/app/page.tsx`, `/src/app/page.test.tsx`
- `/src/components/landing/hero.tsx`, `/src/components/landing/hero.test.tsx`, `/src/components/landing/header.tsx`, `/src/components/landing/footer.tsx`
- `/src/components/ui/button.tsx`, `/src/components/ui/card.tsx`
- `/src/lib/auth/routes.ts`, `/src/lib/auth/routes.test.ts` (`/sample`은 보호 대상이 아니다)
- 이전 step 산출물:
  - `/src/types/transaction.ts`, `/src/lib/transactions/categories.ts`
  - `/src/lib/dashboard/period.ts`, `/src/lib/dashboard/summarize.ts`
  - `/src/components/dashboard/dashboard-view.tsx`
  - `/src/app/dashboard/page.tsx` (같은 컴포넌트를 실제 데이터로 쓰는 쪽)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

가입하지 않은 방문자가 가상 데이터로 대시보드를 미리 볼 수 있는 공개 페이지 `/sample`을 만들고, 랜딩 히어로에서 그 페이지로 가는 버튼을 추가한다. 이 페이지는 DB도 Claude도 호출하지 않는다.

구현 파일보다 테스트 파일을 먼저 작성하라. 이미 있는 `hero.tsx`를 고칠 때도 `hero.test.tsx`를 먼저 고쳐야 `tdd_guard.py`가 통과시킨다.

### 1. 가상 데이터 (`src/lib/sample/transactions.ts`)

```ts
export const SAMPLE_TRANSACTIONS: Transaction[];
// recentMonthRange(SAMPLE_TRANSACTIONS의 가장 최근 날짜). 날짜를 문자열로 다시 적지 말고 배열에서 구한다.
export const SAMPLE_RANGE: DateRange;
```

- `SAMPLE_TRANSACTIONS`는 코드에 직접 적은 고정 배열이다. 난수와 현재 날짜를 쓰지 마라. 이유: 렌더링할 때마다 숫자가 달라지면 안 되고 테스트가 고정돼야 한다.
- 40~60건, 날짜는 모두 `2026-09-01`부터 `2026-09-30` 사이이고 가장 최근 날짜는 `2026-09-30`이다. 배열은 날짜 내림차순이다.
- `id`는 `sample-1`, `sample-2`처럼 겹치지 않게 붙인다.
- 지출 카테고리를 8개 이상 쓰고, 수입 1~2건(`kind: "income"`, `category: "수입"`)과 `이체` 1~2건을 넣는다. 환불(음수 지출) 1건을 넣는다.
- 금액은 원 단위 정수이고 한 사람의 한 달 소비로 그럴듯한 크기다.
- 가맹점명은 지어낸 이름을 쓴다 (`모닝커피 역삼점`, `한끼식당` 등). 실제 사람 이름과 실존 브랜드명을 쓰지 마라. 이유: 가상 데이터임이 분명해야 하고 특정 업체를 보여 줄 이유가 없다.
- `category` 값은 `MERCHANT_CATEGORIES`, `TRANSFER_CATEGORY`, `INCOME_CATEGORY`의 값만 쓴다.

### 2. 안내 배너 (`src/components/landing/sample-banner.tsx`)

```ts
export function SampleBanner(): JSX.Element;
```

- 문구 `가상 데이터로 만든 샘플 화면이에요. 내 거래 내역으로 보려면 가입해 주세요.`와 `ButtonLink` `무료로 시작하기` → `/signup`.
- `"use client"` 없는 서버 컴포넌트다.

### 3. 페이지 (`src/app/sample/page.tsx`)

- metadata title은 `샘플 대시보드 | FinSight`.
- 구성: `LandingHeader`, `<main>` 안에 h1 `샘플 대시보드`, `SampleBanner`, `DashboardView`, 그리고 `LandingFooter`.
- `DashboardView`에는 `SAMPLE_RANGE`, `summarize(SAMPLE_TRANSACTIONS)`, `SAMPLE_TRANSACTIONS`를 넘긴다. 합계를 미리 계산한 숫자로 적어 두지 마라. 이유: 실제 대시보드와 같은 함수를 거쳐야 샘플이 실제 화면과 어긋나지 않는다.
- 업로드 폼은 넣지 않는다.
- 정적 페이지다. `force-dynamic`을 넣지 말고 Supabase, `getCurrentUser`, `@/services/`를 import 하지 마라. 이유: 가입 전 방문자가 보는 페이지라 빠르게 떠야 하고 외부 호출이 필요 없다.
- 로그인 여부와 상관없이 누구나 볼 수 있다. `src/proxy.ts`와 `resolveAuthRedirect`의 구현은 고치지 않는다.

### 4. 히어로 버튼 (`src/components/landing/hero.tsx`)

- `무료로 시작하기` 옆에 `ButtonLink` `샘플 먼저 보기`를 추가한다 (`href="/sample"`, `variant="secondary"`, `size="lg"`).
- 좁은 화면에서는 두 버튼이 세로로 쌓이고 넓은 화면에서는 나란히 놓인다.
- 히어로의 다른 문구와 링크는 그대로 둔다.

### 5. 테스트

- `src/lib/sample/transactions.test.ts` (첫 줄에 `// @vitest-environment node`):
  - 건수가 40~60이다.
  - `id`가 겹치지 않는다.
  - 모든 `date`가 `YYYY-MM-DD` 형식이고 `2026-09-01`~`2026-09-30` 안이며 내림차순이다.
  - 모든 `amount`가 정수다.
  - 모든 `category`가 허용된 값이다. 수입 거래의 카테고리는 `수입`이고 지출 거래의 카테고리는 `수입`이 아니다.
  - 지출 카테고리가 8종류 이상이다.
  - `SAMPLE_RANGE`의 `to`가 가장 최근 날짜이고, 모든 거래가 그 기간 안에 들어 있다.
  - `summarize` 결과의 `totalExpense`와 `totalIncome`이 0보다 크다.
- `src/components/landing/sample-banner.test.tsx`: 문구와 `/signup` 링크.
- `src/components/landing/hero.test.tsx`: `샘플 먼저 보기` 링크가 `/sample`로 간다. 기존 테스트는 그대로 통과해야 한다.
- `src/app/sample/page.test.tsx`: h1 `샘플 대시보드`, 배너 문구, `총 지출`, `카테고리별 지출`, `거래 내역`이 보이고 `올리기` 버튼은 없다.
- `src/lib/auth/routes.test.ts`에 경우를 추가한다: `/sample`은 로그인 여부와 상관없이 null. 구현(`routes.ts`)은 고치지 않는다.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -u ANTHROPIC_API_KEY npm run build
npm run test
test -f src/lib/sample/transactions.test.ts && test -f src/components/landing/sample-banner.test.tsx && test -f src/app/sample/page.test.tsx
grep -q 'href="/sample"' src/components/landing/hero.tsx
! grep -rn "supabase\|@/services\|getCurrentUser\|force-dynamic" src/app/sample src/lib/sample
! grep -n "Math.random\|Date.now\|new Date(" src/lib/sample/transactions.ts
git diff --quiet main -- src/proxy.ts src/lib/auth/routes.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 빌드 출력에서 `/sample`이 정적 페이지(○)로 표시되는지 확인한다.
3. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
4. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (새 경로, 파일, 히어로 변경을 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 샘플 데이터를 DB에 넣거나 샘플용 계정을 만들지 마라. 이유: 샘플은 코드에 든 고정 데이터만 쓴다.
- 샘플 페이지에서 파일 업로드나 Claude 분류를 실행하게 하지 마라. 이유: 가입하지 않은 방문자가 비용이 드는 호출을 일으키면 안 된다.
- 샘플 전용 대시보드 컴포넌트를 따로 만들지 마라. 이유: `DashboardView`를 그대로 써야 실제 화면과 같아진다.
- Pro 기능(AI 인사이트, 월별 추이, 랭킹, 정기결제)의 샘플이나 잠금 카드를 넣지 마라. 이유: Phase 2 범위다.
- 랜딩에 기능 소개, 요금제, 후기 섹션을 추가하지 마라. 이유: 이 step의 랜딩 변경은 버튼 하나다.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
