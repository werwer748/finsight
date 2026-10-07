# Step 6: db-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL: 사용자 데이터를 담는 테이블은 전부 RLS를 켜고 `user_id`로 격리한다)
- `/docs/PRD.md`
- `/docs/ARCHITECTURE.md` (디렉토리 구조의 `supabase/migrations/`)
- `/docs/ADR.md` (ADR-002, ADR-004, ADR-007, ADR-010, ADR-011, ADR-012, ADR-014)
- `/src/types/transaction.ts`, `/src/lib/transactions/categories.ts` (step 0 산출물: 저장할 거래의 모양)
- `/src/lib/classify/merchant-key.ts` (step 3 산출물: 캐시 키의 모양)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

거래, 가맹점 캐시, 업로드 기록을 담을 테이블 세 개와 RLS 정책을 SQL 마이그레이션 한 파일로 작성한다. 이 step은 SQL 파일만 만든다. 실제 DB에 적용하는 일은 사용자가 Supabase SQL 에디터에서 직접 한다. 이 phase의 마지막 step(step 12 `apply-migration`)이 사용자가 적용을 확인할 때까지 phase가 끝나지 않게 막는다. 이유: step 8과 step 10의 코드는 실행할 때 이 세 테이블이 있어야 한다.

### 파일: `supabase/migrations/20261007000000_dashboard.sql`

파일 맨 위에 무엇을 만드는지 한국어 주석으로 두세 줄 적는다. 주석에는 `create table`, `enable row level security`, `create policy`, `for update`라는 문구를 그대로 적지 마라. 이유: Acceptance Criteria가 이 문구가 든 줄 수를 센다.

### 1. `public.transactions`

| 열 | 타입 | 제약 |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `user_id` | `uuid` | not null, `auth.users(id)` 참조, `on delete cascade` |
| `date` | `date` | not null |
| `merchant` | `text` | not null (빈 문자열 허용) |
| `amount` | `bigint` | not null (원 단위 정수, 음수 허용) |
| `kind` | `text` | not null, `check (kind in ('expense', 'income'))` |
| `category` | `text` | not null |
| `fingerprint` | `text` | not null |
| `created_at` | `timestamptz` | not null, default `now()` |

- `unique (user_id, fingerprint)` 제약을 둔다. 이유: 같은 파일을 다시 올려도 거래가 두 번 들어가지 않게 하는 멱등성의 근거다. 앱은 이 제약을 충돌 기준으로 삼아 새 거래만 넣고(`on conflict do nothing`), 이미 있던 거래는 같은 기준으로 카테고리만 보정한다(`on conflict do update`, 아래 4의 update 정책).
- `(user_id, date desc)` 인덱스를 둔다. 이유: 대시보드가 사용자별 최근 날짜와 기간으로 조회한다.

### 2. `public.merchant_categories`

| 열 | 타입 | 제약 |
|---|---|---|
| `user_id` | `uuid` | not null, `auth.users(id)` 참조, `on delete cascade` |
| `merchant` | `text` | not null (숫자열을 가린 가맹점 키) |
| `category` | `text` | not null |
| `created_at` | `timestamptz` | not null, default `now()` |

- primary key는 `(user_id, merchant)`다.

### 3. `public.uploads`

로그인한 사용자의 업로드 요청 한 번에 한 행을 남긴다. 하루 업로드 횟수 상한(남용 방지)을 세는 데만 쓴다 (ADR-011).

| 열 | 타입 | 제약 |
|---|---|---|
| `id` | `uuid` | primary key, default `gen_random_uuid()` |
| `user_id` | `uuid` | not null, `auth.users(id)` 참조, `on delete cascade` |
| `created_at` | `timestamptz` | not null, default `now()` |

- `(user_id, created_at desc)` 인덱스를 둔다. 이유: 사용자별로 최근 24시간 안의 업로드 수를 센다.
- 열은 위 세 개뿐이다. 파일 이름, 크기, 내용, 플랜, 월 한도를 담는 열을 만들지 않는다. 이유: 원본 파일에 관한 정보는 어디에도 저장하지 않고, 플랜과 무료 플랜의 월 업로드 한도는 Phase 2 범위다 (ADR-011).

### 4. RLS와 권한 (세 테이블 모두)

- `alter table ... enable row level security;`
- 정책의 대상 역할은 모두 `authenticated`다. 세 테이블에 각각 아래 두 개를 만든다.
  - select: `using ((select auth.uid()) = user_id)`
  - insert: `with check ((select auth.uid()) = user_id)`
- `public.transactions`에만 update 정책을 하나 더 만든다: `using ((select auth.uid()) = user_id)`와 `with check ((select auth.uid()) = user_id)`를 둘 다 건다. 이유: 같은 파일을 다시 올리면 step 7이 분류에 실패해 `기타`로 저장됐던 거래의 카테고리를 새 분류 결과로 다시 쓴다.
- 정책은 모두 일곱 개다 (`transactions` 3개, `merchant_categories` 2개, `uploads` 2개).
- update 정책의 `using` 절과 `with check` 절은 서로 다른 줄에 쓴다. 이유: Acceptance Criteria가 `auth.uid()`가 든 줄 수를 센다.
- 권한은 정책과 같은 범위로 준다.
  - `grant select, insert, update on public.transactions to authenticated;`
  - `grant select, insert on public.merchant_categories to authenticated;`
  - `grant select, insert on public.uploads to authenticated;`
- delete 정책은 어느 테이블에도 만들지 않는다. update 정책과 `update` 권한은 `transactions`에만 둔다. 이유: 이 phase에는 사용자가 거래를 고치거나 지우는 기능이 없다. 그 기능은 Phase 2에서 필요한 정책과 함께 추가한다.
- `anon` 역할에는 아무 권한도 주지 않는다.

### 5. 하지 않는 것

- `category`에 check 제약을 걸지 않는다. 이유: 카테고리 목록은 코드(`MERCHANT_CATEGORIES`)가 원본이고, 목록을 바꿀 때마다 마이그레이션을 쓰지 않기 위해서다.
- 계좌번호, 카드번호, 잔액, 원본 파일명, 원본 행을 담는 열을 만들지 않는다.
- 거래 시각을 담는 열을 만들지 않는다. 이유: 거래 타입의 `time`은 step 7이 중복 판별용 지문을 만드는 데만 쓰고 DB에는 저장하지 않는다 (ADR-014).

## Acceptance Criteria

```bash
npm run lint
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY -u ANTHROPIC_API_KEY npm run build
npm run test
f=supabase/migrations/20261007000000_dashboard.sql
test -f "$f"
test "$(grep -ci 'create table' "$f")" = "3"
test "$(grep -ci 'enable row level security' "$f")" = "3"
test "$(grep -ci 'create policy' "$f")" = "7"
test "$(grep -ci 'auth.uid()' "$f")" -ge 8
test "$(grep -ci 'for update' "$f")" = "1"
grep -qi 'unique (user_id, fingerprint)' "$f"
grep -qi 'primary key (user_id, merchant)' "$f"
! grep -qi 'service_role\|to anon\|to public\|using (true)\|for delete\|for all' "$f"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. SQL을 처음부터 끝까지 다시 읽고 확인한다:
   - 테이블 세 개 모두 RLS가 켜져 있고 정책이 `user_id`로 걸려 있는가?
   - update 정책과 `update` 권한이 `transactions`에만 있고, delete 정책은 어느 테이블에도 없는가?
   - `uploads`에 `id`, `user_id`, `created_at` 말고 다른 열이 없는가?
   - 열 이름이 위 표와 한 글자도 다르지 않은가? (step 7의 코드가 이 이름으로 조회한다)
   - 문장마다 세미콜론이 있고 Postgres 문법에 맞는가? 이 step에서는 SQL을 실행해 볼 수 없으므로 눈으로 확인해야 한다.
3. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
4. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (파일 경로, 세 테이블과 열 이름, 유니크 제약, 정책 범위(update는 `transactions`에만 있음)를 적고 "사용자가 Supabase SQL 에디터에서 직접 적용해야 하고, step 12가 그 확인을 기다림"을 적는다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

실제 Supabase 프로젝트는 이 step에 필요하지 않다. DB에 적용할 수 없다는 이유로 `blocked` 처리하지 마라. 적용은 사용자가 직접 하고, 적용했는지는 이 phase의 마지막 step(step 12 `apply-migration`)에서 확인한다.

## 금지사항

- Supabase CLI를 설치하거나 `supabase db push`, `psql` 등으로 DB에 접속하려 하지 마라. 이유: 이 환경에는 프로젝트 연결 정보가 없고, 적용은 사용자가 직접 한다.
- `profiles`, `plans`, `subscriptions` 같은 다른 테이블을 만들지 마라. `uploads`는 반드시 만들되 플랜이나 월 한도를 담는 열을 넣지 마라. 이유: 플랜과 무료 플랜의 월 업로드 한도는 Phase 2 범위다. 이 phase의 `uploads`는 하루 남용 상한을 세는 데만 쓴다 (ADR-011).
- 전체 사용자가 공유하는 캐시 테이블을 만들지 마라. 이유: 캐시는 사용자별이다 (ADR-010).
- service role 키를 쓰는 코드나 RLS를 우회하는 `security definer` 함수를 만들지 마라. 이유: 모든 접근은 로그인한 사용자의 세션과 RLS를 거친다.
- TypeScript 코드를 추가하거나 고치지 마라. 이유: 이 step은 SQL 파일 하나다. DB를 읽고 쓰는 코드는 step 7 범위다.
- 기존 테스트를 깨뜨리지 마라.
