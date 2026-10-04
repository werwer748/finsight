# Step 5: dashboard-shell

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 규칙: 권한 체크는 서버에서)
- `/docs/PRD.md` (개발 단계: 이 phase의 대시보드는 빈 껍데기다)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/scripts/tdd_guard.py`
- `/src/lib/supabase/server.ts`, `/src/lib/supabase/update-session.ts` 와 각 테스트 파일
- `/src/proxy.ts` (또는 step 3 summary에 적힌 요청 가로채기 파일)
- `/src/lib/auth/actions.ts`, `/src/lib/auth/actions.test.ts`
- `/src/app/login/page.tsx`, `/src/app/signup/page.tsx`
- `/src/components/ui/button.tsx`, `/src/components/ui/card.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

로그인한 사용자만 볼 수 있는 `/dashboard`의 껍데기를 만들고 경로 보호를 붙인다. 구현 파일보다 테스트 파일을 먼저 작성하라. 이미 커밋된 구현 파일을 고칠 때도 그 파일의 테스트를 먼저 수정해야 `tdd_guard.py`가 통과시킨다.

### 1. 경로 규칙 (`src/lib/auth/routes.ts`)

```ts
// 리다이렉트할 경로를 돌려준다. 그대로 두면 null.
export function resolveAuthRedirect(pathname: string, isAuthenticated: boolean): string | null;
```

- 비로그인 상태로 `/dashboard` 또는 그 하위 경로 → `/login`
- 로그인 상태로 `/login` 또는 `/signup` → `/dashboard`
- 그 외 → `null`

### 2. 요청 가로채기 파일에 리다이렉트 추가 (`src/proxy.ts`)

`updateSession`이 돌려주는 `isAuthenticated`와 `resolveAuthRedirect`로 리다이렉트를 결정한다.

- 리다이렉트 응답을 새로 만들 때는 `updateSession`의 `response`에 담긴 쿠키를 새 응답으로 전부 복사하라. 복사하지 않으면 갱신된 세션이 사라져 사용자가 로그아웃된다.
- 리다이렉트가 없으면 `response`를 그대로 돌려준다.
- 같은 폴더에 `proxy.test.ts`를 두고 `@/lib/supabase/update-session`을 mock으로 대체해 테스트한다.

### 3. 현재 사용자 조회 (`src/lib/auth/session.ts`)

```ts
export type CurrentUser = { id: string; email: string };
// 로그인하지 않았으면 null.
export async function getCurrentUser(): Promise<CurrentUser | null>;
```

- `createClient()`로 만든 클라이언트의 `auth.getClaims()`를 쓴다. `getSession()`은 쓰지 마라.
- claims의 `sub`를 `id`로, `email`을 `email`로 돌려준다.

### 4. 컴포넌트 (`src/components/dashboard/`)

```ts
// dashboard-header.tsx — 서비스 이름, 사용자 이메일, 로그아웃 버튼
export function DashboardHeader(props: { email: string }): React.JSX.Element;
// empty-state.tsx — 아직 데이터가 없을 때의 안내
export function EmptyState(): React.JSX.Element;
```

- `DashboardHeader`의 로그아웃은 `<form action={signOut}>` 안의 `로그아웃` 버튼으로 만든다. 클라이언트 컴포넌트로 만들 필요가 없다.
- `EmptyState`: 제목 `아직 분석한 내역이 없어요`, 설명 `거래 내역 파일을 올리면 여기에서 소비 분석을 볼 수 있어요. 업로드 기능은 곧 추가됩니다.`

### 5. 페이지 (`src/app/dashboard/page.tsx`)

- `getCurrentUser()`를 호출하고 null이면 `/login`으로 리다이렉트한다. proxy의 리다이렉트와 별개로 페이지에서도 확인한다 (이중 방어).
- `DashboardHeader`와 `EmptyState`를 조합한다. metadata title은 `대시보드 | FinSight`.

### 6. 테스트

- `routes.test.ts`: 위 세 규칙과 경계 사례 (`/dashboard/anything`, `/`, `/dashboardx`는 보호 대상이 아님).
- `proxy.test.ts`: 비로그인 `/dashboard` 요청은 `/login`으로, 로그인 `/login` 요청은 `/dashboard`로, 그 외는 통과. 리다이렉트 응답에 세션 쿠키가 복사됨.
- `session.test.ts`: claims가 있으면 사용자 반환, 없거나 오류면 null. `@/lib/supabase/server`를 mock으로 대체한다.
- `dashboard-header.test.tsx`: 이메일과 `로그아웃` 버튼이 보임. `@/lib/auth/actions`는 mock으로 대체한다.
- `empty-state.test.tsx`: 제목과 설명이 보임.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
npm run test
test -f src/lib/auth/routes.test.ts && test -f src/lib/auth/session.test.ts && test -f src/proxy.test.ts
test -f src/components/dashboard/dashboard-header.test.tsx && test -f src/components/dashboard/empty-state.test.tsx
! grep -rn "getSession(" src/ --include="*.ts" --include="*.tsx" --exclude="*.test.ts" --exclude="*.test.tsx"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-skeleton/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 파일 업로드, 차트, 거래 테이블, 요금제 표시를 만들지 마라. 이유: Phase 1과 Phase 2의 범위다. 이 step의 대시보드는 헤더와 빈 상태 안내뿐이다.
- DB 테이블이나 마이그레이션을 만들지 마라. 이유: 이 phase는 저장할 데이터가 없다.
- 로그인 여부를 클라이언트에서만 확인하지 마라. 이유: CLAUDE.md의 CRITICAL 규칙상 권한 체크는 서버에서 한다.
- 사이드바, 설정 페이지, 프로필 페이지를 만들지 마라. 이유: 계획에 없는 화면이다.
- 차트 라이브러리나 UI 라이브러리를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
