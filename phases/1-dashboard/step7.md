# Step 7: transaction-store

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL: 합계는 코드로 계산, 사용자 데이터는 RLS와 `user_id`로 격리)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-002, ADR-004, ADR-007, ADR-010, ADR-011, ADR-014)
- `/scripts/tdd_guard.py`
- `/supabase/migrations/20261007000000_dashboard.sql` (step 6 산출물: 세 테이블 `transactions`, `merchant_categories`, `uploads`의 열 이름, 유니크 제약, `transactions`의 update 정책)
- `/src/lib/supabase/server.ts`, `/src/lib/supabase/server.test.ts` (서버용 Supabase 클라이언트)
- `/src/lib/auth/session.ts`, `/src/lib/auth/session.test.ts` (Supabase를 mock으로 대체한 기존 테스트의 모양)
- `/src/types/transaction.ts`, `/src/types/dashboard.ts`, `/src/lib/transactions/categories.ts` (step 0, 4 산출물)
- `/src/lib/dashboard/period.ts` (step 4 산출물: `recentMonthRange`)
- `/src/lib/classify/classify-transactions.ts` (step 3 산출물: `ClassifyDeps`의 `loadCache`, `saveCache`가 이 step의 함수를 받는다)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

거래, 가맹점 캐시, 업로드 기록을 Supabase에서 읽고 쓰는 함수를 만든다. 모든 함수는 호출하는 쪽이 만든 `SupabaseClient`(로그인한 사용자의 세션 클라이언트)를 인자로 받는다. 이 모듈 안에서 클라이언트를 만들지 않는다.

구현 파일보다 테스트 파일을 먼저 작성하라.

### 1. 지문 (`src/lib/transactions/fingerprint.ts`)

```ts
// 각 거래에 중복 판별용 지문을 붙인다. 입력 순서를 유지한다.
export function withFingerprints<
  T extends Pick<CategorizedTransaction, "date" | "time" | "merchant" | "amount" | "kind">,
>(transactions: T[]): (T & { fingerprint: string })[];
```

- 지문은 `JSON.stringify([date, time, merchant, amount, kind, occurrence])`의 SHA-256 16진수 문자열이다 (`node:crypto`). `time`은 `"HH:mm"` 또는 null이고, null이면 null 그대로 배열에 넣는다.
- `time`을 지문에 넣는다. 이유: 서로 다른 파일(카드 두 장, 또는 한 계좌를 기간을 나눠 내려받은 두 파일)에서 온 서로 다른 거래 두 건이 같은 날 같은 곳 같은 금액이면, 시각 없이는 지문이 같아져 두 번째 거래가 중복으로 버려진다 (ADR-014).
- `occurrence`는 같은 배열 안에서 `date`, `time`, `merchant`, `amount`, `kind`가 모두 같은 거래가 **앞에 몇 번 나왔는지**다(0부터). 이유: 한 파일 안에서 이 다섯 값이 모두 같은 거래 두 건을 서로 다른 거래로 남기면서, 같은 파일을 다시 올리면 지문이 똑같이 나오게 한다.
- `category`는 지문에 넣지 않는다. 이유: 분류 결과가 달라져도 같은 거래여야 한다.
- 시각이 없는 파일끼리는 위 경우에 여전히 같은 지문이 되고, 같은 거래를 시각이 있는 파일과 없는 파일로 한 번씩 올리면 두 번 저장된다. 알려진 한계이며 이 step에서 다른 값으로 메우지 않는다 (ADR-014).

### 2. 저장소 (`src/lib/transactions/store.ts`)

```ts
export async function loadMerchantCache(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, MerchantCategory>>;

export async function saveMerchantCache(
  supabase: SupabaseClient,
  userId: string,
  entries: Map<string, MerchantCategory>,
): Promise<void>;

export async function saveTransactions(
  supabase: SupabaseClient,
  userId: string,
  transactions: CategorizedTransaction[],
): Promise<{ inserted: number; duplicates: number }>;

// 저장된 거래가 없으면 null.
export async function getRecentTransactions(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ range: DateRange; transactions: Transaction[] } | null>;

// since(ISO 시각 문자열) 이후에 기록된 이 사용자의 업로드 수.
export async function countUploadsSince(
  supabase: SupabaseClient,
  userId: string,
  since: string,
): Promise<number>;

// 업로드 한 번을 기록한다.
export async function recordUpload(
  supabase: SupabaseClient,
  userId: string,
): Promise<void>;
```

`countUploadsSince`와 `recordUpload`는 step 8의 업로드 라우트가 하루 업로드 상한(ADR-011)을 확인하고 기록하는 데 쓴다.

공통 규칙:

- **1000행 제한**: Supabase는 한 번의 조회에 최대 1000행만 돌려준다. 여러 행을 읽는 조회는 `.range()`로 1000행씩, 받은 행이 1000개보다 적어질 때까지 반복해서 **끝까지** 읽어라. 페이지를 나눌 때는 결과가 흔들리지 않게 정렬 기준을 명시한다. 이유: 잘린 데이터로 합계를 내면 금액이 틀린다.
- **사용자 격리**: 읽기는 `.eq("user_id", userId)`를 붙이고, 쓰기는 모든 행에 `user_id: userId`를 넣는다. RLS가 같은 것을 한 번 더 막지만 코드에서도 명시한다.
- **오류**: Supabase 응답의 `error`가 있으면 한국어 메시지의 `Error`를 던진다. 메시지와 로그에 거래 내용(가맹점명, 금액)을 넣지 마라.
- **청크**: 쓰기는 500행씩 나눠 순서대로 보낸다.

함수별 규칙:

- `loadMerchantCache`: `merchant_categories`에서 이 사용자의 행 전부를 읽는다. `isMerchantCategory`를 통과하지 못하는 `category`는 버린다. 가맹점 키 목록을 `.in()` 필터로 넘기지 마라. 이유: 한글 키 수백 개가 URL 길이 제한을 넘는다.
- `saveMerchantCache`: `upsert`에 `{ onConflict: "user_id,merchant", ignoreDuplicates: true }`를 쓴다. `entries`가 비어 있으면 아무것도 호출하지 않는다.
- `saveTransactions`: `withFingerprints`로 지문을 붙인 뒤, 500행 청크마다 `transactions`에 아래 두 호출을 순서대로 한다. 저장하는 열은 `user_id, date, merchant, amount, kind, category, fingerprint`뿐이다. `time`은 지문을 만드는 데만 쓰고 행에 넣지 않는다. 이유: `transactions` 테이블에 시각 열이 없다 (ADR-014). 빈 배열이면 아무것도 호출하지 않고 `{ inserted: 0, duplicates: 0 }`.
  1. 새 거래 넣기: `upsert(rows, { onConflict: "user_id,fingerprint", ignoreDuplicates: true })`에 `.select("fingerprint")`를 붙인다. 이미 저장된 지문의 행은 건드리지 않고, 새로 들어간 행의 지문만 돌아온다. 돌아온 행 수를 모든 청크에 걸쳐 더한 값이 `inserted`이고 `duplicates`는 전체 건수에서 `inserted`를 뺀 값이다.
  2. 카테고리 보정: 같은 청크의 행 중 1에서 지문이 돌아오지 **않은** 행(이미 저장돼 있던 거래)이면서 `category`가 `FALLBACK_CATEGORY`가 아닌 행만 골라 `upsert(rows, { onConflict: "user_id,fingerprint", ignoreDuplicates: false })`로 보낸다. 그런 행이 없으면 두 번째 호출을 하지 않는다. 이유: Claude 호출이 실패해 `기타`로 저장된 거래를, 같은 파일을 다시 올렸을 때 새 분류 결과로 고친다. 새 카테고리가 `기타`인 행은 보내지 않으므로 제대로 분류돼 있던 거래가 `기타`로 덮이지 않는다.
  3. 2의 결과는 `inserted`와 `duplicates`에 넣지 않는다. 보정된 거래도 `duplicates`로 센다.
  4. 어떤 행이 이미 있었는지는 1의 응답만으로 판단한다. 저장된 지문을 따로 조회하거나 지문 목록을 `.in()` 필터로 넘기지 마라. 이유: 지문 수백 개가 URL 길이 제한을 넘는다.
- `getRecentTransactions`:
  1. 이 사용자의 가장 최근 `date` 하나를 조회한다. 없으면 null.
  2. `recentMonthRange(최근 날짜)`로 기간을 구한다.
  3. `date`가 `from` 이상 `to` 이하인 거래를 `date` 내림차순, 같으면 `id` 오름차순으로 끝까지 읽는다. 읽는 열은 `id, date, merchant, amount, kind, category`다.
  4. 기간 제한은 반드시 DB 쿼리에서 건다. 전부 읽은 뒤 코드에서 잘라내지 마라. 이유: 무료 조회 범위는 서버에서 강제한다 (ADR-007, ADR-011).
- `countUploadsSince`: `uploads`에서 `select("id", { count: "exact", head: true })`에 `.eq("user_id", userId)`와 `.gte("created_at", since)`를 붙이고 응답의 `count`를 돌려준다. `since`는 호출하는 쪽이 정한 값을 그대로 쓴다. 행을 읽어 와서 세지 마라. 이유: 필요한 것은 개수뿐이다. 행을 읽지 않으므로 `.range()` 반복도 필요 없다. `error`가 없어도 `count`가 숫자가 아니면 오류를 던진다. 이유: 개수를 모를 때 0으로 보면 상한이 조용히 풀린다.
- `recordUpload`: `uploads`에 `{ user_id: userId }` 한 행을 `insert` 한다. 다른 값은 넣지 않는다. 이유: `id`와 `created_at`은 DB 기본값으로 채워지고, 파일 이름·크기·내용은 어디에도 저장하지 않는다.

### 3. 테스트

- 두 테스트 파일 모두 첫 줄에 `// @vitest-environment node`를 둔다.
- `fingerprint.test.ts`:
  - 같은 입력이면 항상 같은 지문
  - 완전히 같은 거래 두 건은 서로 다른 지문
  - 같은 배열을 다시 넣으면 지문 목록이 똑같다
  - `category`만 다른 거래는 같은 지문
  - `date`, `time`, `merchant`, `amount`, `kind` 중 하나만 달라도 다른 지문
  - `time`만 다른 두 거래(`"09:05"`와 `"18:30"`)는 다른 지문이다. 한 배열에 함께 넣었을 때의 지문이 각각 혼자 넣었을 때의 지문과 같다 (`occurrence`는 `time`까지 같은 거래만 센다)
  - `time`이 null인 거래도 지문이 만들어지고, `time`이 null인 거래와 `"09:05"`인 거래는 다른 지문이다. `time`이 null인 완전히 같은 거래 두 건은 서로 다른 지문이다
- `store.test.ts`: 실제 Supabase에 접속하지 마라. 쿼리 빌더를 흉내 내는 작은 fake를 테스트 파일 안에 만들고, 어떤 테이블에 어떤 메서드와 인자가 호출됐는지 확인한다. `saveTransactions`의 첫 번째 `upsert`에 대해서는 fake가 넘어온 행 중 일부의 `fingerprint`를 골라 돌려주게 만든다.
  - `saveTransactions`: 첫 번째 `upsert`에 넘어간 행에 `user_id`와 `fingerprint`가 있고 `time` 키는 없다. 옵션은 `onConflict: "user_id,fingerprint"`, `ignoreDuplicates: true`이고 `.select("fingerprint")`가 호출된다.
  - `saveTransactions`: fake가 3건 중 1건의 지문만 돌려주면 `{ inserted: 1, duplicates: 2 }`다. 돌아오지 않은 2건을 `식비` 1건과 `기타` 1건으로 두면, 두 번째 `upsert`에는 `식비` 1건만 가고 그 옵션은 `onConflict: "user_id,fingerprint"`, `ignoreDuplicates: false`다. 그 행에도 `user_id`와 `fingerprint`가 있고 `time` 키는 없다.
  - `saveTransactions`: fake가 모든 지문을 돌려주면(전부 새 거래) 두 번째 `upsert`가 없다.
  - `saveTransactions`: 돌아오지 않은 행이 전부 `기타`면 두 번째 `upsert`가 없다.
  - `saveTransactions`: 1200건이면 첫 번째 호출의 `upsert`(`ignoreDuplicates: true`)가 3번(500, 500, 200) 일어난다.
  - `getRecentTransactions`: 거래가 없으면 null이고 두 번째 조회를 하지 않는다.
  - `getRecentTransactions`: 최근 날짜가 `2026-09-13`이면 `.gte("date", "2026-08-14")`와 `.lte("date", "2026-09-13")`가 호출된다.
  - `getRecentTransactions`: fake가 1000행, 그다음 200행을 돌려주면 결과가 1200행이다.
  - `loadMerchantCache`: 1000행을 넘는 캐시를 끝까지 읽고, 목록에 없는 카테고리 값은 결과에 없다.
  - `saveMerchantCache`: 빈 `Map`이면 호출이 없다.
  - `countUploadsSince`: `uploads` 테이블에 `select("id", { count: "exact", head: true })`, `.eq("user_id", userId)`, `.gte("created_at", since)`가 호출되고, fake가 준 `count`를 그대로 돌려준다. `count`가 null이면 reject 한다.
  - `recordUpload`: `uploads` 테이블에 `insert`가 `{ user_id: userId }`로 한 번 호출된다.
  - 각 함수에서 `error`가 돌아오면 reject 한다. `saveTransactions`는 두 번째 `upsert`의 `error`에도 reject 한다.
  - 읽기 조회마다 `.eq("user_id", userId)`가 호출된다.

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -u ANTHROPIC_API_KEY npm run build
npm run test
test -f src/lib/transactions/fingerprint.test.ts && test -f src/lib/transactions/store.test.ts
grep -q 'time' src/lib/transactions/fingerprint.ts
grep -q 'ignoreDuplicates' src/lib/transactions/store.ts
grep -q '\.range(' src/lib/transactions/store.ts
grep -q 'countUploadsSince' src/lib/transactions/store.ts && grep -q 'recordUpload' src/lib/transactions/store.ts
! grep -n "createClient\|service_role\|SUPABASE_SECRET\|\.in(" src/lib/transactions/store.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
   - 코드의 테이블·열 이름이 step 6의 SQL과 같은가?
   - 저장하는 행에 `time`이 들어가지 않는가?
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (파일 경로, 여섯 함수의 시그니처, 지문 규칙(시각 포함), `saveTransactions`의 두 호출(새 거래 넣기와 `기타` 보정), 1000행 페이지 처리를 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트와 키는 이 step에 필요하지 않다. 모든 검증은 fake로 한다. 키가 없다는 이유로 `blocked` 처리하지 마라.

## 금지사항

- 이 모듈 안에서 Supabase 클라이언트를 만들지 마라. 이유: 요청마다 만든 세션 클라이언트를 받아야 RLS가 그 사용자로 적용된다.
- service role 키나 secret 키를 쓰는 클라이언트를 추가하지 마라. 이유: RLS를 우회하게 된다 (ADR-010).
- 합계나 카테고리별 집계를 SQL이나 RPC로 계산하지 마라. 이유: 집계는 step 4의 `summarize`가 코드로 한다.
- 거래 수정, 삭제, 검색, 필터 함수를 만들지 마라. 저장된 거래의 카테고리를 다시 쓰는 곳은 `saveTransactions` 안의 보정 호출 하나뿐이다. 이유: 수정·삭제·검색·필터는 Pro 기능이고 Phase 2 범위다.
- 하루 업로드 상한 값이나 24시간 기준 시각 계산을 이 모듈에 넣지 마라. 이유: `countUploadsSince`는 받은 `since` 이후의 개수만 돌려준다. 상한 값, 기준 시각, 상한을 넘었을 때의 응답은 step 8이 정한다.
- 플랜에 따라 조회 기간을 바꾸는 인자를 넣지 마라. 이유: 플랜 정보는 Phase 2에서 생긴다.
- step 6의 SQL 파일을 고치지 마라. 이유: 스키마는 확정됐다. 열 이름이 맞지 않으면 코드를 SQL에 맞춰라.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
