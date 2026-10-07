# Step 8: upload-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 규칙 전부)
- `/docs/PRD.md` (핵심 기능 1, 요금제 표)
- `/docs/ARCHITECTURE.md` (패턴: 파일 업로드는 `src/app/api/` 라우트 핸들러, 데이터 흐름의 "분석")
- `/docs/ADR.md` (ADR-001, ADR-006, ADR-011, ADR-012)
- `/scripts/tdd_guard.py`
- `/src/app/auth/confirm/route.ts`, `/src/app/auth/confirm/route.test.ts` (기존 라우트 핸들러와 테스트의 모양)
- `/src/lib/auth/session.ts` (`getCurrentUser`)
- `/src/lib/supabase/server.ts` (`createClient`)
- `/src/proxy.ts`, `/src/lib/auth/routes.ts` (요청 가로채기: `/api/upload`는 리다이렉트 대상이 아니다)
- 이전 step 산출물:
  - `/src/lib/parser/read-sheet.ts` (`readSheet`, `ParseError`)
  - `/src/lib/parser/normalize.ts` (`normalizeRows`)
  - `/src/lib/classify/classify-transactions.ts` (`classifyTransactions`, `ClassifyDeps`)
  - `/src/services/claude.ts` (`classifyMerchants`)
  - `/src/lib/transactions/store.ts` (`loadMerchantCache`, `saveMerchantCache`, `saveTransactions`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

파일을 받아 파싱 → 분류 → 저장까지 실행하는 `POST /api/upload`를 만든다. 로직은 이전 step에서 다 만들었으므로 이 step은 그것들을 순서대로 잇고, 입력 검증과 오류 응답을 정한다.

구현 파일보다 테스트 파일을 먼저 작성하라.

### 1. 타입 (`src/types/upload.ts`)

```ts
export type UploadResult = {
  total: number; // 파일에서 읽은 거래 수
  inserted: number; // 새로 저장한 거래 수
  duplicates: number; // 이미 있어서 건너뛴 거래 수
};

export type UploadErrorBody = { error: string };
```

### 2. 파일 검증 (`src/lib/upload/validate.ts`)

```ts
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_TRANSACTIONS_PER_UPLOAD = 5000;

// 문제가 없으면 null, 있으면 사용자에게 보여 줄 한국어 문구.
export function validateUploadFile(file: { name: string; size: number }): string | null;
```

- 확장자가 `.csv`, `.xlsx`, `.xls`(대소문자 무시)가 아니면 `"CSV 또는 Excel(.xlsx, .xls) 파일만 올릴 수 있어요."`
- 크기가 0이면 `"빈 파일이에요."`
- 크기가 `MAX_UPLOAD_BYTES`를 넘으면 `"파일이 너무 커요. 4MB 이하 파일을 올려 주세요."`
- 이 함수는 step 9의 클라이언트 컴포넌트도 가져다 쓴다. Node 전용 API나 서버 모듈을 import 하지 마라.

### 3. 라우트 핸들러 (`src/app/api/upload/route.ts`)

```ts
export const maxDuration = 60;
export async function POST(request: Request): Promise<Response>;
```

처리 순서:

1. `getCurrentUser()`가 null이면 **요청 본문을 읽기 전에** 401 `{ error: "로그인이 필요해요." }`.
2. `request.formData()`의 `file` 필드가 `File`이 아니면 400 `{ error: "파일을 선택해 주세요." }`. 본문을 formData로 읽지 못해도 같은 응답이다.
3. `validateUploadFile`이 문구를 돌려주면 400.
4. `readSheet` → `normalizeRows`. `ParseError`면 그 메시지로 400.
5. 거래가 `MAX_TRANSACTIONS_PER_UPLOAD`건을 넘으면 400 `{ error: "한 번에 올릴 수 있는 거래는 5,000건까지예요. 기간을 나눠서 올려 주세요." }`.
6. `createClient()`로 세션 클라이언트를 만들고 `classifyTransactions`를 호출한다. `deps`는 `loadCache: () => loadMerchantCache(supabase, user.id)`, `classify: classifyMerchants`, `saveCache: (entries) => saveMerchantCache(supabase, user.id, entries)`.
7. `saveTransactions(supabase, user.id, 분류된 거래)`.
8. 200 `UploadResult`.
9. 그 밖의 예외는 500 `{ error: "업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }`. 예외의 메시지를 응답에 넣지 마라.

규칙:

- **권한은 서버에서**: 사용자 ID는 `getCurrentUser()`의 결과만 쓴다. 요청 본문이나 헤더로 받은 ID를 믿지 마라.
- **로그**: 500일 때 `console.error`로 예외를 남긴다. 파일 내용, 파일 이름, 가맹점명, 금액을 로그에 남기지 마라.
- **저장하지 않는 것**: 원본 파일과 파일 이름은 어디에도 저장하지 않는다.
- **멱등성**: 같은 파일을 두 번 올리면 두 번째 응답은 `inserted: 0`이다. 이것은 step 7의 지문과 유니크 제약이 보장하므로 여기서 따로 중복 검사를 만들지 마라.
- **업로드 횟수 제한 없음**: 무료 플랜의 월 1회 제한은 이 phase에 넣지 않는다 (ADR-011).
- 응답은 모두 JSON이다. `redirect()`를 쓰지 마라. 이유: 이 엔드포인트는 클라이언트의 `fetch`가 호출한다.

### 4. 테스트

- 두 테스트 파일 모두 첫 줄에 `// @vitest-environment node`를 둔다.
- `validate.test.ts`: 세 가지 오류 문구와 통과하는 경우(`.CSV` 대문자 포함), 정확히 `MAX_UPLOAD_BYTES`인 파일은 통과.
- `route.test.ts`: 경계만 mock으로 대체한다 — `@/lib/auth/session`, `@/lib/supabase/server`, `@/lib/transactions/store`, `@/services/claude`. **파서와 분류 로직은 실제 코드를 그대로 쓴다.** 요청은 `FormData`에 작은 UTF-8 CSV `File`을 담아 만든다.
  - 비로그인이면 401이고 `saveTransactions`가 호출되지 않는다.
  - `file` 필드가 없으면 400.
  - `.pdf` 파일, 4MB 초과 파일은 각각 400과 정해진 문구.
  - 표가 없는 CSV는 400과 `ParseError`의 문구.
  - 정상 CSV: 200과 `{ total, inserted, duplicates }`. `saveTransactions`가 로그인한 사용자 ID와 카테고리가 붙은 거래로 호출된다.
  - 이체 행과 입금 행이 섞인 CSV: 그 행들의 내용(예: `홍길동`)이 `classifyMerchants`의 인자에 없다. 해당 거래는 `이체`, `수입`으로 저장된다.
  - `classifyMerchants`가 빈 `Map`을 돌려줘도 200이고 해당 거래는 `기타`다.
  - `saveTransactions`가 reject 하면 500과 일반 문구이고, 응답 본문에 원래 예외 메시지가 없다.
  - 요청 본문에 `userId`를 넣어 보내도 무시된다.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -u ANTHROPIC_API_KEY npm run build
npm run test
test -f src/app/api/upload/route.test.ts && test -f src/lib/upload/validate.test.ts && test -f src/types/upload.ts
grep -q "getCurrentUser" src/app/api/upload/route.ts
! grep -n "redirect(\|getSession(" src/app/api/upload/route.ts
! grep -rn "supabase\|@/services\|node:" src/lib/upload/validate.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (LLM 전송 범위, 서버 권한 체크)
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (엔드포인트, 요청 필드 이름, 상태 코드별 응답 모양, 제한값을 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 업로드 화면이나 컴포넌트를 만들지 마라. 이유: step 9 범위다.
- 업로드 횟수 제한, 플랜 확인을 넣지 마라. 이유: Phase 2 범위다 (ADR-011).
- 파일을 디스크, Supabase Storage, 외부 저장소에 저장하지 마라. 이유: 원본 파일은 보관하지 않는다.
- 파서·분류·저장 함수의 동작을 이 step에서 바꾸지 마라. 이유: 각 step에서 검증이 끝났다. 꼭 고쳐야 하면 그 파일의 테스트부터 고쳐라.
- 서버 액션으로 만들지 마라. 이유: ARCHITECTURE.md가 파일 업로드는 라우트 핸들러로 정했다.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
