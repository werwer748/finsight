# Step 4: auth-flow

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 규칙: 외부 서비스 호출은 서버에서만, UI 문구는 한국어)
- `/docs/PRD.md` (핵심 기능 5, MVP 제외 사항)
- `/docs/ARCHITECTURE.md` (데이터 흐름의 인증 줄)
- `/docs/ADR.md` (ADR-003, ADR-008)
- `/scripts/tdd_guard.py`
- `/src/lib/supabase/env.ts`, `/src/lib/supabase/server.ts`, `/src/lib/supabase/update-session.ts` 와 각 테스트 파일
- `/src/proxy.ts` (또는 step 3 summary에 적힌 요청 가로채기 파일)
- `/src/components/ui/button.tsx`, `/src/components/ui/input.tsx`, `/src/components/ui/card.tsx`
- `/src/components/landing/header.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

이메일과 비밀번호로 가입, 로그인, 로그아웃하는 흐름을 만든다. 구현 파일보다 테스트 파일을 먼저 작성하라.

### 1. 타입 (`src/types/auth.ts`)

```ts
export type AuthFormState = {
  success?: boolean;
  message?: string; // 폼 전체에 대한 안내 또는 오류
  errors?: { email?: string; password?: string; passwordConfirm?: string };
};
```

### 2. 검증과 오류 문구 (`src/lib/auth/`)

```ts
// validation.ts — 순수 함수. 문제가 없으면 null, 있으면 한국어 오류 문구.
export function validateEmail(email: string): string | null;
export function validatePassword(password: string): string | null;       // 8자 이상
export function validatePasswordConfirm(password: string, confirm: string): string | null;

// errors.ts — Supabase 인증 오류를 한국어 문구로 바꾼다.
export function toAuthErrorMessage(error: { code?: string; message?: string }): string;
```

`toAuthErrorMessage`의 대응:

| Supabase 오류 코드 | 문구 |
|---|---|
| `invalid_credentials` | 이메일 또는 비밀번호가 올바르지 않아요. |
| `email_not_confirmed` | 이메일 확인이 필요해요. 받은 메일의 링크를 눌러 주세요. |
| `user_already_exists`, `email_exists` | 이미 가입된 이메일이에요. |
| `weak_password` | 비밀번호는 8자 이상이어야 해요. |
| `over_request_rate_limit`, `over_email_send_rate_limit` | 요청이 너무 많아요. 잠시 후 다시 시도해 주세요. |
| 그 외 | 문제가 생겼어요. 잠시 후 다시 시도해 주세요. |

### 3. 서버 액션 (`src/lib/auth/actions.ts`, `"use server"`)

```ts
export async function signUp(prev: AuthFormState, formData: FormData): Promise<AuthFormState>;
export async function signIn(prev: AuthFormState, formData: FormData): Promise<AuthFormState>;
export async function signOut(): Promise<void>;
```

- `signUp`: 입력을 검증하고, 문제가 있으면 `errors`를 돌려준다 (Supabase를 호출하지 않는다). 통과하면 `supabase.auth.signUp`을 호출하되 `emailRedirectTo`를 `요청 origin + /auth/confirm`으로 준다. origin은 요청 헤더에서 얻는다.
  - 응답에 세션이 있으면(이메일 확인이 꺼진 프로젝트) `/dashboard`로 리다이렉트한다.
  - 세션이 없으면 `success: true`와 안내 문구 `확인 메일을 보냈어요. 메일의 링크를 눌러 가입을 마쳐 주세요.`를 돌려준다. 이미 가입된 이메일이어도 Supabase는 오류 없이 응답하는데, 이때도 같은 안내를 보여준다 (가입 여부를 노출하지 않는다).
- `signIn`: 검증 후 `supabase.auth.signInWithPassword`를 호출한다. 성공하면 `/dashboard`로 리다이렉트, 실패하면 `message`에 `toAuthErrorMessage` 결과를 담는다.
- `signOut`: `supabase.auth.signOut` 후 `/`로 리다이렉트한다.
- `redirect()`는 예외를 던져 동작하므로 `try/catch` 안에서 호출하지 마라.
- 비밀번호를 로그에 남기거나 반환값에 담지 마라.

### 4. 이메일 확인 콜백 (`src/app/auth/confirm/route.ts`)

GET 핸들러. 메일의 링크가 이 주소로 돌아온다. 두 가지 형태를 모두 처리한다.

- `token_hash`와 `type` 쿼리가 있으면 `supabase.auth.verifyOtp`로 확인한다.
- `code` 쿼리가 있으면 `supabase.auth.exchangeCodeForSession`으로 교환한다.
- 성공하면 `/dashboard`로, 실패하거나 쿼리가 없으면 `/login?notice=confirm-failed`로 리다이렉트한다.

같은 폴더에 `route.test.ts`를 둔다.

### 5. 화면

`src/components/auth/`에 클라이언트 컴포넌트 두 개를 만든다. `useActionState`로 서버 액션과 연결하고, step 1의 `Input`, `Button`, `Card`를 쓴다.

```ts
// signup-form.tsx — 이메일, 비밀번호, 비밀번호 확인
export function SignupForm(): React.JSX.Element;
// login-form.tsx — 이메일, 비밀번호
export function LoginForm(props: { notice?: string }): React.JSX.Element;
```

- 필드별 오류는 `Input`의 `error`로, 폼 전체 문구(`message`)는 폼 위에 보여준다.
- 제출 중에는 버튼을 비활성화한다.
- `SignupForm`은 `success`가 true면 폼 대신 안내 문구를 보여준다.
- `LoginForm`의 `notice`가 `confirm-failed`면 `이메일 확인을 마치지 못했어요. 로그인해서 다시 시도해 주세요.`를 보여준다.
- 가입 화면에는 로그인으로, 로그인 화면에는 가입으로 가는 링크를 둔다.

페이지는 얇게 만든다.

- `src/app/signup/page.tsx`: 가운데 정렬된 카드 안에 서비스 이름(`/` 링크), 제목 `회원가입`, `SignupForm`.
- `src/app/login/page.tsx`: 같은 레이아웃, 제목 `로그인`, `LoginForm`. `searchParams`의 `notice`를 읽어 전달한다.

### 6. 환경변수

새 환경변수를 추가하지 않는다.

### 7. 테스트

실제 Supabase를 호출하지 않는다. `@/lib/supabase/server`, `next/navigation`, `next/headers`를 mock으로 대체한다.

- `validation.test.ts`: 빈 값, 형식이 틀린 이메일, 7자 비밀번호, 불일치하는 비밀번호 확인, 정상 입력.
- `errors.test.ts`: 위 표의 각 코드와 알 수 없는 코드.
- `actions.test.ts`: 검증 실패 시 Supabase 미호출, 가입 성공 시 안내 문구와 `emailRedirectTo` 값, 가입 응답에 세션이 있으면 `/dashboard` 리다이렉트, 로그인 성공 시 리다이렉트, 로그인 실패 시 한국어 문구, 로그아웃 시 `/` 리다이렉트.
- `route.test.ts`: `token_hash` 성공, `code` 성공, 실패, 쿼리 없음.
- `signup-form.test.tsx`, `login-form.test.tsx`: 필드가 라벨로 찾아짐, 액션이 돌려준 오류가 표시됨, `notice` 문구 표시. 서버 액션 모듈은 mock으로 대체한다.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
npm run test
test -f src/lib/auth/validation.test.ts && test -f src/lib/auth/errors.test.ts && test -f src/lib/auth/actions.test.ts
test -f src/app/auth/confirm/route.test.ts
test -f src/components/auth/signup-form.test.tsx && test -f src/components/auth/login-form.test.tsx
! grep -rn "createBrowserClient\|signInWithOAuth\|resetPasswordForEmail" src/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-skeleton/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (서버 액션 경로와 이름, 페이지 경로, 콜백 경로를 포함하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 클라이언트 컴포넌트에서 Supabase를 직접 호출하지 마라. 이유: CLAUDE.md의 CRITICAL 규칙이다. 폼은 서버 액션만 호출한다.
- 소셜 로그인, 매직링크, 비밀번호 재설정을 만들지 마라. 이유: ADR-003과 PRD의 MVP 제외 사항이다.
- `/dashboard` 페이지와 경로 보호 리다이렉트를 만들지 마라. 이유: step 5의 범위다. 지금은 로그인 후 `/dashboard`가 404여도 된다.
- 폼 라이브러리나 검증 라이브러리(`react-hook-form`, `zod` 등)를 설치하지 마라. 이유: 필드가 세 개뿐이라 순수 함수로 충분하다.
- 프로필 테이블 등 DB 스키마를 만들지 마라. 이유: 이 phase는 Supabase Auth의 기본 사용자 테이블만 쓴다.
- 기존 테스트를 깨뜨리지 마라.
