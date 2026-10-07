# Step 8: upload-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 규칙 전부)
- `/docs/PRD.md` (핵심 기능 1, 요금제 표)
- `/docs/ARCHITECTURE.md` (패턴: 파일 업로드는 `src/app/api/` 라우트 핸들러, 데이터 흐름의 "분석")
- `/docs/ADR.md` (ADR-001, ADR-004, ADR-006, ADR-011, ADR-012, ADR-013, ADR-014)
- `/scripts/tdd_guard.py`
- `/src/app/auth/confirm/route.ts`, `/src/app/auth/confirm/route.test.ts` (기존 라우트 핸들러와 테스트의 모양)
- `/src/lib/auth/session.ts` (`getCurrentUser`)
- `/src/lib/supabase/server.ts` (`createClient`)
- `/src/proxy.ts`, `/src/lib/auth/routes.ts` (요청 가로채기: `/api/upload`는 리다이렉트 대상이 아니다)
- 이전 step 산출물:
  - `/src/lib/parser/file-rules.ts` (`hasSupportedExtension`, `UNSUPPORTED_FORMAT_MESSAGE`, `EMPTY_FILE_MESSAGE`)
  - `/src/lib/parser/read-sheet.ts` (`readSheet`, `ParseError`)
  - `/src/lib/parser/normalize.ts` (`normalizeRows`, 은행 내역에서 `isTransfer`가 어떻게 정해지는지)
  - `/src/lib/classify/classify-transactions.ts` (`classifyTransactions`, `ClassifyDeps`, `ClassifyResult`)
  - `/src/services/claude.ts` (`classifyMerchants`)
  - `/src/lib/transactions/store.ts` (`loadMerchantCache`, `saveMerchantCache`, `saveTransactions`, `countUploadsSince`, `recordUpload`)

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
  unclassified: number; // 분류하지 못해 기타로 저장한 거래 수. 같은 파일을 다시 올리면 다시 분류된다.
};

export type UploadErrorBody = { error: string };
```

### 2. 파일 검증 (`src/lib/upload/validate.ts`)

```ts
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_TRANSACTIONS_PER_UPLOAD = 5000;
export const MAX_UPLOADS_PER_DAY = 20;

// 문제가 없으면 null, 있으면 사용자에게 보여 줄 한국어 문구.
export function validateUploadFile(file: { name: string; size: number }): string | null;

// now의 UTC 날짜에 하루를 더한 날짜 ("YYYY-MM-DD"). UTC 메서드만 쓴다.
export function maxAllowedDate(now: Date): string;
```

- 확장자는 `@/lib/parser/file-rules`의 `hasSupportedExtension`으로 검사한다. 지원하지 않는 확장자면 `UNSUPPORTED_FORMAT_MESSAGE`를 돌려준다.
- 크기가 0이면 `EMPTY_FILE_MESSAGE`를 돌려준다.
- 확장자 목록과 위 두 문구를 이 파일에 다시 적지 마라. 이유: `readSheet`가 같은 상수로 `ParseError`를 던진다. 원본이 한 곳이어야 화면의 검증과 서버의 파서가 같은 파일을 두고 다른 문구를 내지 않는다.
- 크기가 `MAX_UPLOAD_BYTES`를 넘으면 `"파일이 너무 커요. 4MB 이하 파일을 올려 주세요."`
- `maxAllowedDate`는 현재 시각을 인자로만 받는다. 함수 안에서 `new Date()`나 `Date.now()`를 부르지 마라. 날짜 계산은 `Date.UTC`, `getUTC*`로만 한다. 이유: 로컬 시간대 메서드를 쓰면 서버 시간대에 따라 하루가 밀린다. 예: `2026-10-07T15:30:00Z` → `"2026-10-08"`.
- `MAX_UPLOADS_PER_DAY`는 한 사용자가 24시간 동안 올릴 수 있는 횟수다. 라우트 핸들러가 쓴다.
- 이 파일은 step 9의 클라이언트 컴포넌트도 가져다 쓴다. `read-sheet`, `xlsx`, Supabase, `@/services/`, `node:*` 모듈을 import 하지 마라. `file-rules`는 클라이언트에서 써도 되게 만든 모듈이므로 import 해도 된다. 이유: 이 파일이 import 하는 모듈은 전부 브라우저 번들에 들어간다.

### 3. 라우트 핸들러 (`src/app/api/upload/route.ts`)

```ts
export const maxDuration = 60;
export async function POST(request: Request): Promise<Response>;
```

처리 순서:

1. `getCurrentUser()`가 null이면 **요청 본문을 읽기 전에** 401 `{ error: "로그인이 필요해요." }`.
2. `createClient()`로 세션 클라이언트를 만든다. `countUploadsSince(supabase, user.id, since)`가 `MAX_UPLOADS_PER_DAY` 이상이면 429 `{ error: "하루에 올릴 수 있는 횟수를 넘었어요. 내일 다시 시도해 주세요." }`. `since`는 지금으로부터 24시간 전의 ISO 문자열이다 (`new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()`).
3. `recordUpload(supabase, user.id)`로 이 요청을 기록한 뒤 `countUploadsSince`를 같은 `since`로 한 번 더 부른다. 이번에는 방금 기록한 행까지 세므로, 값이 `MAX_UPLOADS_PER_DAY`를 **넘으면** 2와 같은 429다. 2와 3은 모두 요청 본문을 읽기 전에 한다.
4. `request.formData()`의 `file` 필드가 `File`이 아니면 400 `{ error: "파일을 선택해 주세요." }`. 본문을 formData로 읽지 못해도 같은 응답이다.
5. `validateUploadFile`이 문구를 돌려주면 400.
6. `readSheet` → `normalizeRows`. `ParseError`면 그 메시지로 400. 압축을 푼 크기가 한도를 넘는 `.xlsx`도 `readSheet`가 `ParseError`로 알려 주므로 여기서 400이 된다.
7. 거래가 `MAX_TRANSACTIONS_PER_UPLOAD`건을 넘으면 400 `{ error: "한 번에 올릴 수 있는 거래는 5,000건까지예요. 기간을 나눠서 올려 주세요." }`.
8. `date`가 `maxAllowedDate(new Date())`보다 늦은 거래가 하나라도 있으면 400 `{ error: "미래 날짜의 거래가 들어 있어요. 파일의 날짜를 확인해 주세요." }`. 둘 다 `YYYY-MM-DD` 문자열이므로 문자열 비교로 판단한다. 파일 전체를 거절하고, 일부만 골라 저장하지 않는다.
9. `classifyTransactions`를 호출한다. `deps`는 `loadCache: () => loadMerchantCache(supabase, user.id)`, `classify: classifyMerchants`, `saveCache: (entries) => saveMerchantCache(supabase, user.id, entries)`. 결과는 `{ transactions, unclassified }`다.
10. `saveTransactions(supabase, user.id, transactions)`.
11. 200 `UploadResult`. `total`은 파일에서 읽은 거래 수, `inserted`와 `duplicates`는 `saveTransactions`의 결과, `unclassified`는 `classifyTransactions`의 결과다.
12. 그 밖의 예외는 500 `{ error: "업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요." }`. 예외의 메시지를 응답에 넣지 마라.

규칙:

- **권한은 서버에서**: 사용자 ID는 `getCurrentUser()`의 결과만 쓴다. 요청 본문이나 헤더로 받은 ID를 믿지 마라.
- **로그**: 500일 때 `console.error`로 예외를 남긴다. 파일 내용, 파일 이름, 가맹점명, 금액을 로그에 남기지 마라.
- **저장하지 않는 것**: 원본 파일과 파일 이름은 어디에도 저장하지 않는다. `recordUpload`가 남기는 행에는 사용자 ID와 시각만 있다.
- **멱등성**: 같은 파일을 두 번 올리면 두 번째 응답은 `inserted: 0`이다. 이것은 step 7의 지문과 유니크 제약이 보장하므로 여기서 따로 중복 검사를 만들지 마라. 분류에 실패해 `기타`로 저장됐던 거래는 같은 파일을 다시 올릴 때 step 7의 `saveTransactions`가 새 카테고리로 고친다. 이 보정도 여기서 따로 만들지 마라.
- **하루 업로드 상한**: 한 사용자가 최근 24시간(달력 날짜가 아니라 요청 시각 기준) 동안 보낸 업로드 요청이 `MAX_UPLOADS_PER_DAY`번이면 그다음 요청은 429다. 플랜과 상관없이 모든 사용자에게 같은 값을 적용하는 남용 방지 장치다. 이유: 업로드 한 번이 유료 Claude 요청을 최대 100번(거래 5,000건 ÷ 배치 50개) 일으킬 수 있는데, 이것 말고는 가입한 계정이 이 엔드포인트를 부르는 횟수를 막는 장치가 없다. 무료 플랜의 월 1회 제한은 플랜 정보가 생기는 Phase 2에서 붙인다 (ADR-011).
- **횟수는 먼저 기록하고 다시 센다**: 처리 순서 2에서 세고, 3에서 기록한 뒤 다시 센다. 세기만 하고 나중에 기록하지 마라. 이유: 세는 시점과 기록하는 시점 사이가 벌어지면 한꺼번에 보낸 요청들이 모두 같은 횟수를 보고 통과해 상한이 의미가 없어진다. 기록한 뒤에 다시 세면 통과하는 요청 수가 `MAX_UPLOADS_PER_DAY`를 넘지 못한다. 2의 검사를 따로 두는 것은 이미 상한에 닿은 사용자의 요청이 행을 계속 늘려 24시간이 지나도 풀리지 않는 일을 막기 위해서다.
- **거절된 요청도 횟수에 넣는다**: 파일 형식이나 내용 문제로 400이 되는 요청도 3에서 이미 기록돼 있다. 이유: 그런 요청도 파일을 읽고 푸는 비용을 쓴다. 횟수에 넣지 않으면 일부러 깨뜨린 파일을 제한 없이 보낼 수 있다.
- **미래 날짜 거절**: 미래 날짜가 든 파일은 한 건도 저장하지 않는다. 이유: 대시보드의 조회 기간은 저장된 거래 중 가장 최근 날짜를 끝으로 잡고(ADR-011), 이 phase에는 거래를 지우는 기능이 없다. 잘못된 미래 날짜가 한 건이라도 저장되면 조회 기간이 그 날짜에 고정돼 나머지 내역이 화면에서 사라진다. 하루의 여유를 두는 것은 한국 시간이 UTC보다 앞서 있어서, 서버의 UTC 날짜로는 내일인 거래가 정상 파일에 들어 있을 수 있기 때문이다.
- 응답은 모두 JSON이다. `redirect()`를 쓰지 마라. 이유: 이 엔드포인트는 클라이언트의 `fetch`가 호출한다.

### 4. 테스트

- 두 테스트 파일 모두 첫 줄에 `// @vitest-environment node`를 둔다.
- `validate.test.ts`:
  - 세 가지 오류 문구와 통과하는 경우(`.CSV` 대문자 포함), 정확히 `MAX_UPLOAD_BYTES`인 파일은 통과.
  - 확장자 오류와 크기 0의 문구는 `@/lib/parser/file-rules`에서 import 한 `UNSUPPORTED_FORMAT_MESSAGE`, `EMPTY_FILE_MESSAGE`와 비교한다. 문자열을 테스트에 다시 적지 마라.
  - `maxAllowedDate`: `2026-10-07T15:30:00Z` → `2026-10-08`, 달이 넘어가는 `2026-10-31T00:00:00Z` → `2026-11-01`, 해가 넘어가는 `2026-12-31T23:59:59Z` → `2027-01-01`.
  - `MAX_UPLOADS_PER_DAY`는 20이다.
- `route.test.ts`: 경계만 mock으로 대체한다 — `@/lib/auth/session`, `@/lib/supabase/server`, `@/lib/transactions/store`(`loadMerchantCache`, `saveMerchantCache`, `saveTransactions`, `countUploadsSince`, `recordUpload`), `@/services/claude`. **파서와 분류 로직은 실제 코드를 그대로 쓴다.** 요청은 `FormData`에 작은 UTF-8 CSV `File`을 담아 만든다. `countUploadsSince`의 기본값은 0이다.
  - 현재 시각을 고정한다: `beforeEach`에서 `vi.useFakeTimers({ toFake: ["Date"] })`와 `vi.setSystemTime(new Date("2026-10-07T03:00:00Z"))`, `afterEach`에서 `vi.useRealTimers()`. `Date`만 가짜로 바꾸고 `setTimeout` 같은 타이머는 그대로 둔다. 이유: 미래 날짜 검사의 결과가 테스트를 돌리는 날에 따라 달라지면 안 되고, 필요한 것은 현재 날짜뿐이다. CSV의 날짜는 이 시각에 맞춰 적는다 (정상 거래는 `2026-09`의 날짜).
  - 비로그인이면 401이고 `countUploadsSince`와 `saveTransactions`가 호출되지 않는다.
  - `countUploadsSince`가 첫 호출에서 `MAX_UPLOADS_PER_DAY`를 돌려주면 429와 정해진 문구다. 요청 본문은 읽히지 않고(`request.bodyUsed`가 false), `recordUpload`, `classifyMerchants`, `saveTransactions`가 호출되지 않는다.
  - `countUploadsSince`가 첫 호출에서 `MAX_UPLOADS_PER_DAY - 1`, 둘째 호출에서 `MAX_UPLOADS_PER_DAY + 1`을 돌려주면(동시에 들어온 다른 요청이 먼저 기록한 경우) 429다. `recordUpload`는 한 번 호출돼 있고, 요청 본문은 읽히지 않으며 `classifyMerchants`와 `saveTransactions`가 호출되지 않는다.
  - `countUploadsSince`가 첫 호출에서 `MAX_UPLOADS_PER_DAY - 1`, 둘째 호출에서 `MAX_UPLOADS_PER_DAY`를 돌려주면 정상 CSV가 200이다.
  - `countUploadsSince`가 두 번 모두 로그인한 사용자 ID와 고정한 시각의 24시간 전(`2026-10-06T03:00:00.000Z`)으로 호출된다. `recordUpload`는 첫 번째 `countUploadsSince`보다 뒤에, 두 번째보다 앞에 호출된다.
  - `file` 필드가 없으면 400.
  - `.pdf` 파일, 4MB 초과 파일은 각각 400과 정해진 문구.
  - 표가 없는 CSV는 400과 `ParseError`의 문구.
  - 날짜가 `2026-10-09`인 행이 하나 섞인 CSV는 400과 정해진 문구이고 `saveTransactions`가 호출되지 않는다. 가장 늦은 날짜가 `2026-10-08`인 CSV는 200이다.
  - 400으로 끝나는 위의 모든 경우에도 `recordUpload`는 한 번 호출돼 있다 (본문을 읽기 전에 기록한다). 401에서는 호출되지 않는다.
  - 정상 CSV: 200과 `{ total, inserted, duplicates, unclassified }`. `saveTransactions`가 로그인한 사용자 ID와 카테고리가 붙은 거래로 호출된다. `recordUpload`가 로그인한 사용자 ID로 정확히 한 번 호출된다. `classifyMerchants`가 모든 가맹점의 카테고리를 돌려주면 `unclassified`는 0이다.
  - 은행 CSV (헤더 `거래일시,거래구분,기재내용,출금(원),입금(원),거래후 잔액(원)`): 거래구분이 `체크카드`인 출금 행, `타행이체`인 출금 행, `전자금융`인 출금 행(내용 `홍길동`), `타행이체`인 입금 행(내용 `김영희`)을 섞는다. 두 이체 출금 행과 입금 행의 내용이 `classifyMerchants`의 인자에 없고, `체크카드` 행의 가맹점만 들어 있다. 두 이체 출금 거래는 `이체`, 입금 거래는 `수입`으로 저장된다.
  - `classifyMerchants`가 빈 `Map`을 돌려줘도 200이고 해당 거래는 `기타`다. 응답의 `unclassified`는 그 거래의 수다.
  - `saveTransactions`가 reject 하면 500과 일반 문구이고, 응답 본문에 원래 예외 메시지가 없다. 이때도 `recordUpload`는 한 번 호출돼 있다.
  - 요청 본문에 `userId`를 넣어 보내도 무시된다.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -u ANTHROPIC_API_KEY npm run build
npm run test
TZ=America/Los_Angeles npx vitest run src/lib/upload src/app/api/upload
TZ=Asia/Seoul npx vitest run src/lib/upload src/app/api/upload
test -f src/app/api/upload/route.test.ts && test -f src/lib/upload/validate.test.ts && test -f src/types/upload.ts
grep -q "getCurrentUser" src/app/api/upload/route.ts
grep -q "countUploadsSince" src/app/api/upload/route.ts
grep -q "recordUpload" src/app/api/upload/route.ts
grep -q "maxAllowedDate" src/app/api/upload/route.ts
grep -q "file-rules" src/lib/upload/validate.ts
! grep -n "redirect(\|getSession(" src/app/api/upload/route.ts
! grep -rn "supabase\|@/services\|node:\|read-sheet\|from \"xlsx\"\|from 'xlsx'" src/lib/upload/validate.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (LLM 전송 범위, 서버 권한 체크)
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (엔드포인트, 요청 필드 이름, 상태 코드별 응답 모양(401·429·400·500 포함, 200의 `unclassified` 포함), 제한값(파일 크기, 거래 수, 하루 업로드 횟수), 미래 날짜 거절 규칙, `validate.ts`의 export를 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 API 키는 이 step에 필요하지 않다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 업로드 화면이나 컴포넌트를 만들지 마라. 이유: step 9 범위다.
- 플랜 확인과 무료 플랜의 월 업로드 횟수 제한을 넣지 마라. 이유: 플랜 정보가 생기는 Phase 2 범위다 (ADR-011). 이 step이 넣는 횟수 제한은 플랜과 상관없이 모든 사용자에게 똑같이 적용하는 하루 상한(`MAX_UPLOADS_PER_DAY`) 하나뿐이다.
- 파일을 디스크, Supabase Storage, 외부 저장소에 저장하지 마라. 이유: 원본 파일은 보관하지 않는다.
- 파서·분류·저장 함수의 동작을 이 step에서 바꾸지 마라. 이유: 각 step에서 검증이 끝났다. 꼭 고쳐야 하면 그 파일의 테스트부터 고쳐라.
- 서버 액션으로 만들지 마라. 이유: ARCHITECTURE.md가 파일 업로드는 라우트 핸들러로 정했다.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
