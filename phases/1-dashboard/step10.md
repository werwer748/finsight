# Step 10: dashboard-page

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL: 권한 체크는 서버에서, 합계는 코드로 계산)
- `/docs/PRD.md` (핵심 기능 3, 요금제 표)
- `/docs/ARCHITECTURE.md` (패턴: 페이지는 데이터 조회와 컴포넌트 조합만 한다)
- `/docs/ADR.md` (ADR-007, ADR-011, ADR-015)
- `/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` (`error.tsx`가 받는 props: `error`, `retry`)
- `/src/app/dashboard/page.tsx` (지금의 빈 대시보드)
- `/src/app/page.tsx`, `/src/app/page.test.tsx` (페이지 테스트의 기존 모양)
- `/src/lib/auth/session.ts`, `/src/lib/supabase/server.ts`
- 이전 step 산출물:
  - `/src/lib/transactions/store.ts` (`getRecentTransactions`)
  - `/src/lib/dashboard/summarize.ts` (`summarize`)
  - `/src/components/dashboard/dashboard-view.tsx`, `upload-form.tsx`, `empty-state.tsx`, `dashboard-header.tsx`
  - `/src/components/ui/card.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`/dashboard` 페이지를 실제 데이터에 연결한다. 페이지는 조회하고, 집계 함수를 부르고, 컴포넌트에 넘기는 일만 한다.

`src/app/dashboard/`는 `tdd_guard.py`의 감시 대상이 아니지만 이 step도 테스트를 먼저 작성하라.

### 1. `src/app/dashboard/page.tsx`

처리 순서:

1. `getCurrentUser()`가 null이면 `/login`으로 리다이렉트한다 (지금 코드 그대로).
2. `createClient()`로 세션 클라이언트를 만들고 `getRecentTransactions(supabase, user.id)`를 호출한다.
3. 화면 구성:
   - `DashboardHeader` (지금 그대로)
   - h1 `대시보드`
   - `Card` 안의 `UploadForm` — 데이터가 있든 없든 항상 보인다.
   - 결과가 null이면 `EmptyState`
   - 결과가 있으면 `DashboardView`에 `range`, `summarize(transactions)`, `transactions`를 넘긴다.

규칙:

- `export const dynamic = "force-dynamic"`과 `metadata`는 그대로 둔다. 이유: 환경변수 없이 빌드할 때 프리렌더가 Supabase 클라이언트 생성에서 예외를 낸다.
- 조회 기간은 `getRecentTransactions`가 정한 것을 그대로 쓴다. 페이지에서 기간을 다시 계산하거나 쿼리스트링으로 기간을 받지 마라. 이유: 무료 조회 범위를 클라이언트가 바꿀 수 있으면 서버 제한이 무너진다 (ADR-007, ADR-011).
- 합계는 `summarize`의 결과만 쓴다. 페이지에서 금액을 더하지 마라.
- 페이지에 계산·검증 로직을 새로 쓰지 마라. 필요한 함수가 없으면 이전 step의 모듈에 테스트와 함께 추가하라.

### 2. `src/app/dashboard/error.tsx`

```ts
export default function DashboardError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}): JSX.Element;
```

- 조회가 실패했을 때 보이는 오류 화면이다. Next.js 규칙상 `"use client"` 컴포넌트다.
- 제목 `내역을 불러오지 못했어요`, 설명 `잠시 후 다시 시도해 주세요.`, `다시 시도` 버튼(`retry()` 호출).
- `reset`은 props로 받지도 호출하지도 마라. 이유: 설치된 Next.js 16.3에서 `retry()`는 세그먼트를 다시 조회해서 다시 그리지만, `reset()`은 다시 조회하지 않고 다시 그리기만 해서 실패한 결과가 그대로 돌아온다.
- 주석에도 `reset(`이라는 문구를 적지 마라. 이유: Acceptance Criteria가 이 파일에 그 문구가 없는지 검사한다.
- 예외의 메시지를 화면에 보여 주지 마라.

### 3. 테스트 (`src/app/dashboard/page.test.tsx`)

- 페이지는 async 서버 컴포넌트다. `await DashboardPage()`의 결과를 `render`에 넘겨 테스트한다.
- mock으로 대체할 것: `@/lib/auth/session`, `@/lib/supabase/server`, `@/lib/transactions/store`, `@/lib/auth/actions`, `next/navigation`(`redirect`는 실제처럼 예외를 던지게 하고, `useRouter`는 `{ refresh: vi.fn() }`을 돌려주게 한다). `summarize`와 컴포넌트는 실제 코드를 쓴다.
- 다뤄야 할 경우:
  - 비로그인이면 `/login`으로 리다이렉트하고 `getRecentTransactions`가 호출되지 않는다.
  - 결과가 null이면 `아직 분석한 내역이 없어요`와 업로드 폼(`올리기` 버튼)이 보인다.
  - 결과가 있으면 기간 문구, `총 지출`과 코드로 계산된 합계, 카테고리 이름, 거래의 가맹점명이 보이고 업로드 폼도 보인다. 빈 상태 안내는 보이지 않는다.
  - 결과가 있는 경우의 fixture에는 `이체` 거래를 한 건 넣는다. `총 지출` 금액은 그 거래를 뺀 합계이고, 그 거래를 더한 합계는 화면에 없다. 이유: `이체`는 `총 지출`에 들어가지 않는다 (ADR-015).
  - `getRecentTransactions`가 로그인한 사용자의 ID로 호출된다.

### 4. 테스트 (`src/app/dashboard/error.test.tsx`)

- `error`에는 메시지가 있는 `Error`를, `retry`에는 `vi.fn()`을 넘겨 렌더링한다.
- 다뤄야 할 경우:
  - 제목과 설명이 보인다.
  - `다시 시도`를 누르면 `retry`가 호출된다.
  - 넘긴 예외의 메시지 문구가 화면에 없다.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -u ANTHROPIC_API_KEY npm run build
npm run test
test -f src/app/dashboard/page.test.tsx && test -f src/app/dashboard/error.tsx && test -f src/app/dashboard/error.test.tsx
grep -q 'force-dynamic' src/app/dashboard/page.tsx
grep -q 'getRecentTransactions' src/app/dashboard/page.tsx
grep -q 'summarize' src/app/dashboard/page.tsx
! grep -n "searchParams\|\.reduce(\|\.from(" src/app/dashboard/page.tsx
grep -q "retry" src/app/dashboard/error.tsx
! grep -n "reset(" src/app/dashboard/error.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (페이지가 얇은가)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (페이지의 조회·렌더링 흐름과 새 파일을 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 브라우저로 직접 확인할 수 없다는 이유로 `blocked` 처리하지 마라. 검증은 mock 테스트와 빌드로 한다.

## 금지사항

- 페이지에서 Supabase 쿼리(`supabase.from(...)`)를 직접 쓰지 마라. 이유: 조회는 `src/lib/transactions/store.ts`가 맡는다.
- 기간 선택, 월 이동, 검색, 필터 UI를 넣지 마라. 이유: Pro 기능이고 Phase 2 범위다.
- 잠금 카드와 업그레이드 안내를 넣지 마라. 이유: Phase 2 범위다.
- 사이드바, 설정, 프로필 페이지를 만들지 마라. 이유: 계획에 없는 화면이다.
- `src/proxy.ts`와 `src/lib/auth/routes.ts`를 고치지 마라. 이유: 경로 보호는 이미 동작한다.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
