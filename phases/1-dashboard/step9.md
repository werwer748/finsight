# Step 9: dashboard-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL: 클라이언트 컴포넌트에서 Supabase·Polar·Claude를 직접 호출하지 않는다, 합계는 코드로 계산)
- `/docs/PRD.md` (핵심 기능 3, 요금제 표, 디자인)
- `/docs/ARCHITECTURE.md` (패턴, 상태 관리)
- `/docs/ADR.md` (ADR-009, ADR-011)
- `/scripts/tdd_guard.py`
- `/src/app/globals.css` (디자인 토큰: `primary`, `muted`, `border`, `surface`, `danger`, `rounded-base`)
- `/src/components/ui/button.tsx`, `/src/components/ui/card.tsx`, `/src/components/ui/input.tsx`
- `/src/components/dashboard/empty-state.tsx`, `/src/components/dashboard/empty-state.test.tsx`
- `/src/components/auth/login-form.tsx`, `/src/components/auth/login-form.test.tsx` (기존 클라이언트 컴포넌트와 테스트의 모양)
- 이전 step 산출물:
  - `/src/types/transaction.ts`, `/src/types/dashboard.ts`, `/src/types/upload.ts`
  - `/src/lib/format.ts` (`formatWon`, `formatDate`)
  - `/src/lib/upload/validate.ts` (`validateUploadFile`)
  - `/src/app/api/upload/route.ts` (업로드 응답의 모양)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

대시보드를 이루는 컴포넌트를 만든다. 데이터를 조회하거나 집계하지 않고 props로 받은 값을 그리기만 한다. 페이지에 붙이는 일은 step 10이 한다.

구현 파일보다 테스트 파일을 먼저 작성하라. 이미 있는 `empty-state.tsx`를 고칠 때도 `empty-state.test.tsx`를 먼저 고쳐야 `tdd_guard.py`가 통과시킨다.

모든 파일은 `src/components/dashboard/` 아래에 둔다. `UploadForm`만 클라이언트 컴포넌트이고 나머지는 `"use client"` 없는 서버 컴포넌트다.

### 1. `summary-cards.tsx`

```ts
export function SummaryCards(props: { totalExpense: number; totalIncome: number }): JSX.Element;
```

- 카드 두 개: `총 지출`, `총 수입`. 값은 `formatWon`으로 표기한다.
- `총 지출`이 이 화면의 대표 숫자다. `text-5xl` 이상으로 크게, `총 수입`은 그보다 작게(`text-2xl` 정도) 둔다.
- 숫자 글자색은 `foreground`다. 금액에 `tabular-nums`를 쓰지 마라. 이유: 큰 단독 숫자는 고정폭 숫자를 쓰면 자간이 벌어져 보인다.

### 2. `category-chart.tsx`

```ts
export function CategoryChart(props: { categories: CategoryTotal[] }): JSX.Element;
```

- 제목은 h2 `카테고리별 지출`.
- 받은 순서(금액이 큰 순)대로 가로 막대 목록을 그린다. 목록은 `<ol>`이고 한 줄에 카테고리 이름, `formatWon(amount)`, 비율(`Math.round(ratio * 100)`에 `%`), 막대가 있다.
- 막대 길이는 **가장 큰 카테고리 금액 대비** 비율이다 (1위가 100%). 비율 숫자는 `ratio`(전체 대비)를 쓴다. 둘을 섞지 마라.
- 막대: 두께 8~12px, 색은 `bg-primary` 한 가지, 왼쪽 끝은 직각이고 오른쪽 끝만 4px 둥글게. 막대 뒤에 회색 트랙을 깔지 마라. 막대에는 `aria-hidden="true"`를 준다. 이유: 값은 옆의 글자로 이미 읽힌다.
- 글자색은 `foreground`와 `muted`만 쓴다. 글자에 `primary` 색을 입히지 마라. 이유: 색은 막대가 맡고 글자는 읽기 쉬워야 한다.
- 카테고리마다 다른 색을 쓰지 마라. 이유: PRD가 무채색과 포인트 색 한 가지로 정했다. 순위는 길이로 읽힌다.
- `categories`가 비어 있으면 목록 대신 `지출 내역이 없어요.`를 보여 준다.

### 3. `transaction-table.tsx`

```ts
export function TransactionTable(props: { transactions: Transaction[] }): JSX.Element;
```

- 제목은 h2 `거래 내역`, 옆에 건수(`12건`).
- `<table>`로 만들고 열은 `날짜`, `내용`, `카테고리`, `금액` 순이다. 받은 순서 그대로 그린다.
- 날짜는 `formatDate`, 금액은 `formatWon`. 수입은 금액 앞에 `+`를 붙인다 (`+3,000,000원`). 수입과 지출을 색으로만 구분하지 마라.
- 금액 열은 오른쪽 정렬에 `tabular-nums`를 쓴다.
- `merchant`가 빈 문자열이면 `-`를 보여 준다.
- 좁은 화면에서 표가 넘치면 표만 가로로 스크롤되게 감싼다(`overflow-x-auto`).
- 보기 전용이다. 검색, 필터, 정렬, 페이지 나누기, 카테고리 수정을 넣지 마라.

### 4. `upload-form.tsx` (`"use client"`)

```ts
export function UploadForm(): JSX.Element;
```

- 파일 입력 하나(`accept=".csv,.xlsx,.xls"`, 라벨 `거래 내역 파일`)와 `올리기` 버튼.
- 제출하면:
  1. 파일이 없으면 `파일을 선택해 주세요.`
  2. `validateUploadFile`이 문구를 돌려주면 그 문구를 보여 주고 요청하지 않는다.
  3. `FormData`의 `file` 필드에 담아 `fetch("/api/upload", { method: "POST", body })`.
  4. 올리는 동안 버튼은 비활성이고 글자는 `올리는 중…`.
  5. 200이면 `{inserted}건을 저장했어요.`를 보여 주고, `duplicates`가 0보다 크면 뒤에 ` 이미 있는 {duplicates}건은 건너뛰었어요.`를 붙인다. 그리고 `useRouter().refresh()`를 호출해 서버 컴포넌트를 다시 그리게 한다.
  6. 200이 아니면 응답 본문의 `error`를 보여 준다. 본문을 읽지 못하면 `업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.`
  7. `fetch`가 reject 하면 `업로드에 실패했어요. 네트워크 연결을 확인해 주세요.`
- 오류 문구는 `role="alert"`, 성공 문구는 `role="status"`로 둔다.
- 상태는 `useState`로만 관리한다.
- 이 컴포넌트가 호출하는 것은 자기 서버의 `/api/upload`뿐이다. Supabase 클라이언트나 `@/services/`를 import 하지 마라.

### 5. `dashboard-view.tsx`

```ts
export function DashboardView(props: {
  range: DateRange;
  summary: DashboardSummary;
  transactions: Transaction[];
}): JSX.Element;
```

- 위에서부터: 기간 표시(`2026.08.14 ~ 2026.09.13`와 `최근 1개월`), `SummaryCards`, `CategoryChart`, `TransactionTable`.
- 조합만 한다. 이 안에서 `summarize`를 부르거나 데이터를 조회하지 마라. 이유: 로그인한 사용자의 대시보드와 step 11의 샘플 페이지가 같은 컴포넌트에 다른 데이터를 넣어 쓴다.
- h1은 넣지 않는다. 이유: 페이지가 h1을 가진다. 이 컴포넌트의 제목들은 h2다.

### 6. `empty-state.tsx` 문구 수정

- 설명을 `거래 내역 파일을 올리면 여기에서 소비 분석을 볼 수 있어요.`로 바꾼다 (`업로드 기능은 곧 추가됩니다.` 삭제). 제목은 그대로 둔다.

### 7. 테스트 (각 컴포넌트 옆의 `*.test.tsx`)

- `summary-cards.test.tsx`: 두 라벨과 표기된 금액.
- `category-chart.test.tsx`: 제목, 각 카테고리의 이름·금액·비율, 순서가 props와 같음, 1위 막대의 너비가 100%이고 2위가 금액 비율대로임, 빈 배열일 때의 문구.
- `transaction-table.test.tsx`: 열 제목, 날짜와 금액 표기, 수입의 `+`, 빈 `merchant`의 `-`, 건수.
- `upload-form.test.tsx`: `fetch`는 `vi.stubGlobal`로, `next/navigation`의 `useRouter`는 `vi.mock`으로 대체한다.
  - 파일 없이 제출하면 문구가 뜨고 `fetch`가 호출되지 않는다.
  - `.pdf` 파일은 검증 문구가 뜨고 `fetch`가 호출되지 않는다.
  - 정상 파일: `/api/upload`로 POST 되고 본문의 `file`이 그 파일이다. 성공 문구가 뜨고 `refresh`가 호출된다.
  - `duplicates`가 있을 때의 문구.
  - 400 응답의 `error`가 `role="alert"`로 뜨고 `refresh`가 호출되지 않는다.
  - `fetch`가 reject 할 때의 문구.
  - 올리는 동안 버튼이 비활성이다.
- `dashboard-view.test.tsx`: 기간 문구, `총 지출`, `카테고리별 지출`, `거래 내역`이 보인다.
- `empty-state.test.tsx`: 바뀐 설명.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -u ANTHROPIC_API_KEY npm run build
npm run test
for f in summary-cards category-chart transaction-table upload-form dashboard-view; do test -f "src/components/dashboard/$f.tsx" && test -f "src/components/dashboard/$f.test.tsx" || exit 1; done
grep -q '"use client"' src/components/dashboard/upload-form.tsx
test "$(grep -rl '"use client"' src/components/dashboard | wc -l | tr -d ' ')" = "1"
! grep -rn "supabase\|@/services" src/components
! grep -q '"recharts"\|"chart.js"\|"d3"\|"victory"' package.json
! grep -rn "곧 추가됩니다" src
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (UI·차트 라이브러리 없음)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (클라이언트 컴포넌트의 외부 서비스 호출)
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (컴포넌트별 파일 경로와 props, 어느 것이 클라이언트 컴포넌트인지 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 차트 라이브러리나 UI 라이브러리를 설치하지 마라. 이유: ADR-009. 가로 막대는 Tailwind만으로 만든다.
- 도넛·파이 차트를 만들지 마라. 이유: 포인트 색 한 가지로는 조각을 구분할 수 없다.
- 잠금 카드, 업그레이드 버튼, 요금제 표시를 만들지 마라. 이유: Phase 2 범위다.
- AI 인사이트, 월별 추이, 가맹점 랭킹, 정기결제 영역을 만들지 마라. 이유: Pro 기능이고 Phase 2 범위다.
- 다크 모드 스타일(`dark:`)을 넣지 마라. 이유: PRD가 라이트 모드만으로 정했다.
- `src/app/` 아래 파일을 고치지 마라. 이유: 페이지 연결은 step 10 범위다.
- 컴포넌트 안에서 합계나 비율을 다시 계산하지 마라(막대 길이를 위한 최댓값 계산은 예외). 이유: 집계는 `summarize`가 한 곳에서 한다.
- 기존 테스트를 깨뜨리지 마라.
