# Step 3: supabase-client

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 규칙: 외부 서비스 호출은 서버에서만)
- `/docs/ARCHITECTURE.md` (패턴: 환경변수는 사용하는 시점에 읽는다)
- `/docs/ADR.md` (ADR-002, ADR-008)
- `/scripts/tdd_guard.py`
- `/package.json`, `/vitest.config.ts`, `/.env.example`
- `/src/app/layout.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

구현 전에 공식 문서로 현재 권장 방식을 확인하라:

- Supabase: https://supabase.com/docs/guides/auth/server-side/nextjs
- Next.js: 설치된 버전의 요청 가로채기 파일 규칙. Next.js 16부터는 `middleware.ts` 대신 `proxy.ts`를 쓴다. `src/` 폴더를 쓰는 프로젝트에서의 파일 위치와 export 이름을 설치된 버전 문서로 확인하라.

## 작업

서버에서 쓰는 Supabase 클라이언트와 세션 갱신 계층을 만든다. 화면과 인증 동작은 만들지 않는다.

### 1. 패키지

```bash
npm install @supabase/supabase-js @supabase/ssr
```

### 2. 모듈 (`src/lib/supabase/`)

구현 파일보다 테스트 파일을 먼저 작성하라.

```ts
// env.ts
// 환경변수가 없으면 어떤 변수가 빠졌는지 알려주는 Error 를 던진다.
export function getSupabaseEnv(): { url: string; publishableKey: string };
// 두 환경변수가 모두 있는지만 확인한다. 던지지 않는다.
export function hasSupabaseEnv(): boolean;

// server.ts
// 서버 컴포넌트, 서버 액션, 라우트 핸들러에서 쓰는 클라이언트.
export async function createClient(): Promise<SupabaseClient>;

// update-session.ts
// 요청마다 세션 토큰을 갱신하고, 갱신된 쿠키가 담긴 응답과 로그인 여부를 돌려준다.
export async function updateSession(
  request: NextRequest
): Promise<{ response: NextResponse; isAuthenticated: boolean }>;
```

핵심 규칙:

- 환경변수 이름은 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`다.
- 환경변수는 함수가 호출될 때 읽는다. 모듈 최상위에서 읽거나 검증하지 마라. 환경변수 없이 `npm run build`가 통과해야 한다.
- `createClient`는 `@supabase/ssr`의 `createServerClient`와 `next/headers`의 `cookies()`를 쓰고, 쿠키 어댑터는 `getAll`/`setAll` 방식으로 구현한다. 서버 컴포넌트에서 호출되면 `setAll`이 실패할 수 있으므로 그 예외는 삼킨다 (세션 갱신은 proxy가 담당한다).
- `updateSession`:
  - `hasSupabaseEnv()`가 false면 Supabase를 호출하지 않고 요청을 그대로 통과시키며 `isAuthenticated: false`를 돌려준다. 이유: Supabase 설정 전에도 랜딩 페이지가 떠야 한다.
  - 클라이언트를 만든 직후 `supabase.auth.getClaims()`를 호출해 토큰을 검증·갱신한다. 클라이언트 생성과 이 호출 사이에 다른 로직을 넣지 마라.
  - 갱신된 쿠키는 요청과 응답 양쪽에 반영한다 (공식 가이드의 패턴을 따른다).
  - `isAuthenticated`는 `getClaims()`가 유효한 claims를 돌려줬는지로 판단한다.

### 3. 요청 가로채기 파일 (`src/proxy.ts`)

`updateSession(request)`를 호출해 `response`를 그대로 돌려준다. matcher로 정적 파일(`_next/static`, `_next/image`, `favicon.ico`, 이미지 확장자)을 제외한다. 경로 보호와 리다이렉트는 step 5에서 추가하므로 지금은 넣지 않는다.

### 4. 테스트

실제 Supabase를 호출하지 않는다. `@supabase/ssr`와 `next/headers`를 mock으로 대체한다.

- `env.test.ts`: 두 변수가 있으면 값을 돌려줌, 하나라도 없으면 변수 이름이 포함된 오류를 던짐, `hasSupabaseEnv`의 true/false.
- `server.test.ts`: `createServerClient`가 환경변수 값으로 호출됨, 쿠키 어댑터의 `getAll`이 쿠키 저장소의 값을 돌려줌, `setAll`에서 쿠키 저장소가 예외를 던져도 전파되지 않음.
- `update-session.test.ts`: 환경변수가 없으면 Supabase를 호출하지 않고 `isAuthenticated: false`, claims가 있으면 true, 없거나 오류면 false, Supabase가 설정한 쿠키가 응답에 담김.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build   # 환경변수 없이도 빌드 통과
npm run test
test -f src/lib/supabase/env.test.ts && test -f src/lib/supabase/server.test.ts && test -f src/lib/supabase/update-session.test.ts
! grep -rn "SERVICE_ROLE\|createBrowserClient" src/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-skeleton/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (모듈 경로, export 이름, 요청 가로채기 파일의 실제 경로를 포함하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 브라우저용 클라이언트(`createBrowserClient`)를 만들지 마라. 이유: CLAUDE.md의 CRITICAL 규칙상 클라이언트 컴포넌트는 Supabase를 직접 호출하지 않는다.
- service role 키를 쓰거나 환경변수로 추가하지 마라. 이유: RLS를 우회하는 키라서 이 phase에서는 필요가 없다.
- 서버에서 로그인 여부를 `getSession()`으로 판단하지 마라. 이유: 쿠키 값을 검증 없이 읽기 때문에 위조될 수 있다. `getClaims()`를 써라.
- `.env.local`을 만들거나 실제 키를 파일에 적지 마라. 이유: 키는 사용자가 직접 설정한다.
- 로그인·가입 화면, 서버 액션, 경로 보호 리다이렉트를 만들지 마라. 이유: step 4와 step 5의 범위다.
- 기존 테스트를 깨뜨리지 마라.
