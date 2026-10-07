# Step 12: apply-migration

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL: 사용자 데이터를 담는 테이블은 전부 RLS를 켜고 `user_id`로 격리한다)
- `/docs/ARCHITECTURE.md` (디렉토리 구조의 `supabase/migrations/`)
- `/docs/ADR.md` (ADR-002, ADR-011)
- `/phases/1-dashboard/index.json` (이 step의 항목)
- 이전 step 산출물:
  - `/supabase/migrations/20261007000000_dashboard.sql` (step 6 산출물: 사용자가 DB에 적용해야 하는 SQL. 읽기만 한다)
  - `/src/lib/transactions/store.ts` (step 7 산출물: 이 SQL이 만드는 세 테이블을 읽고 쓰는 코드)
  - `/src/app/api/upload/route.ts`, `/src/app/dashboard/page.tsx` (step 8, 10 산출물: 실행될 때 세 테이블이 있어야 하는 코드)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

이 step은 코드를 쓰지 않는다. 사용자가 step 6의 SQL을 실제 Supabase DB에 적용했는지 확인하는 관문이다. 확인되면 `completed`, 확인되지 않으면 `blocked`로 끝낸다.

이유: step 8의 업로드 API와 step 10의 대시보드 페이지는 실행될 때 `transactions`, `merchant_categories`, `uploads` 세 테이블이 있어야 한다. SQL을 적용하기 전에 이 브랜치가 push 되거나 배포되면, Phase 0에서 빈 대시보드를 정상으로 보던 로그인 사용자 전원이 오류 화면을 보게 되고 업로드는 500을 돌려준다. 실행기(`scripts/execute.py`)는 마지막 step이 `completed`가 된 뒤에만 phase를 완료로 표시하고 `--push` 옵션의 push를 하므로, 이 step이 `blocked`인 동안에는 실행기가 브랜치를 밖으로 내보내지 않는다. 이 환경에서는 DB에 접속할 수 없어서 적용 여부는 사용자의 확인으로만 알 수 있다.

### 1. 확인하는 값

- `phases/1-dashboard/index.json`의 `steps`에서 `"step": 12`인 항목을 찾는다.
- 그 항목에 `"migration_applied": true`가 있는지 본다. 값이 JSON 불리언 `true`일 때만 확인된 것으로 본다. 키가 없거나 값이 `false`, 문자열 `"true"`, 숫자처럼 다른 값이면 확인되지 않은 것이다.
- 판단 근거는 이 값 하나뿐이다. SQL 파일이 저장소에 있다는 것, 이전 step이 모두 `completed`라는 것, 다른 step의 `summary`에 적힌 문장은 근거가 아니다. 이유: 그것들은 SQL 파일이 작성됐다는 것만 말해 줄 뿐 DB에 적용됐다는 것을 말해 주지 않는다.
- 이 값은 사용자만 적는다.

### 2. 확인된 경우

- AC 커맨드를 실행해 통과를 확인하고, 이 step의 항목에 `"status": "completed"`와 `summary`를 기록한다.
- `migration_applied`를 포함해 항목의 다른 키는 그대로 둔다.

### 3. 확인되지 않은 경우

- 이 step의 항목에 `"status": "blocked"`와 `blocked_reason`을 기록하고 즉시 중단한다.
- `blocked_reason`에는 아래 문구를 한 줄 그대로 넣는다. 실행기가 이 문구를 터미널에 출력하고, 사용자는 이것만 보고 할 일을 안다. 문구에는 큰따옴표와 줄바꿈이 없어서 JSON 문자열 안에 그대로 넣을 수 있다. 큰따옴표를 추가하지 마라. 이유: 이스케이프가 하나만 어긋나도 `index.json`이 깨지고 실행기가 phase 전체를 읽지 못한다.

```text
DB 마이그레이션 적용 확인이 필요합니다. 적용하기 전에는 이 브랜치를 직접 push 하거나 배포하지 마세요. (1) 배포된 앱이 쓰는 Supabase 프로젝트의 SQL 에디터에서 supabase/migrations/20261007000000_dashboard.sql 의 내용 전체를 실행하세요. 이미 적용했다면 (2)부터 하세요. (2) 같은 곳에서 select to_regclass('public.transactions'), to_regclass('public.merchant_categories'), to_regclass('public.uploads'); 를 실행해 세 값이 모두 null이 아닌지 확인하세요. (3) phases/1-dashboard/index.json 의 step 12 항목에 migration_applied: true 를 추가하고(키에는 다른 키처럼 큰따옴표를 붙이고 true에는 붙이지 않습니다), status를 pending으로 되돌리고, blocked_reason을 지우세요. (4) python3 scripts/execute.py 1-dashboard 를 다시 실행하세요(처음에 --push를 붙였다면 이번에도 붙이세요).
```

- 처음 실행하면 이 경로로 끝나는 것이 정상이다. 실패가 아니다.
- 사용자가 위 안내를 마치고 하네스를 다시 실행하면 이 step이 새 세션에서 다시 실행되고, 그때 2의 경로로 끝난다.

## Acceptance Criteria

```bash
test -f supabase/migrations/20261007000000_dashboard.sql
node -e 'const s = JSON.parse(require("fs").readFileSync("phases/1-dashboard/index.json", "utf8")).steps.find((x) => x.step === 12); process.exit(s && s.migration_applied === true ? 0 : 1)'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 마지막 명령은 step 12 항목의 `migration_applied`가 JSON 불리언 `true`일 때만 통과한다.
2. 마지막 명령이 실패하면 사용자가 아직 확인하지 않았다는 뜻이다. 통과하게 만들려고 고치지 마라. 작업 3대로 `blocked`를 기록한다.
3. 결과에 따라 `phases/1-dashboard/index.json`의 해당 step을 업데이트한다:
   - AC 통과 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (사용자가 `supabase/migrations/20261007000000_dashboard.sql`의 적용을 확인했다는 것과 이 step에서 바꾼 코드가 없다는 것을 적는다)
   - `migration_applied`가 `true`가 아님 → `"status": "blocked"`, `"blocked_reason": "작업 3의 문구"` 후 즉시 중단
   - 그 밖의 문제 (SQL 파일이 없음, `index.json`에 step 12 항목이 없음) → `"status": "error"`, `"error_message": "구체적 에러 내용"`
4. `index.json`을 고친 뒤 `node -e 'JSON.parse(require("fs").readFileSync("phases/1-dashboard/index.json", "utf8"))'`가 오류 없이 끝나는지 확인한다. 이유: 실행기가 이 파일을 JSON으로 읽는다.
5. `git status --short`에 `src/`, `supabase/`, `docs/` 아래 파일이 나오지 않는지 확인한다. `phases/` 아래의 다른 변경은 실행기나 사용자가 한 것이니 되돌리지 마라.

이 step은 다른 step과 달리 `blocked`가 정상 경로다. 확인되지 않은 상태를 `error`로 기록하지 마라. 이유: `error`는 실행기가 같은 세션을 다시 띄워 재시도하게 할 뿐이고, 사용자에게 할 일을 알려 주지 못한다.

## 금지사항

- `migration_applied`를 직접 추가하거나 `true`로 바꾸지 마라. 이유: 이 값은 사용자가 실제 DB에 SQL을 적용하고 확인했다는 표시다. 세션이 쓰면 관문이 없는 것과 같아져, 테이블이 없는 DB를 향한 코드가 배포된다.
- Supabase CLI를 설치하거나 `supabase db push`, `psql`, Supabase API 호출 등으로 DB에 접속하지 마라. SQL을 직접 적용하려 하지도, 테이블이 있는지 직접 확인하려 하지도 마라. `.env.local`을 읽지 마라. 이유: 실제 DB의 스키마를 바꾸는 일은 사용자가 직접 하고, 확인의 근거는 사용자가 적은 값 하나다. `.env.local`에는 사용자의 실제 키가 들어 있다.
- `supabase/migrations/20261007000000_dashboard.sql`을 고치지 마라. 이유: 사용자가 적용했거나 적용할 SQL이다. 파일이 바뀌면 사용자가 확인한 DB와 저장소의 스키마가 달라진다.
- `src/` 아래 코드와 테스트, `docs/`를 고치거나 새 파일을 만들지 마라. 이유: 이 step은 확인만 한다. 코드를 바꾸면 사용자가 확인한 것과 다른 상태가 배포된다.
- `index.json`에서 이 step 항목의 `status`, `summary`, `blocked_reason`, `error_message` 외의 값을 바꾸지 마라. 다른 step의 항목과 `phases/index.json`도 건드리지 마라. 이유: 나머지 값은 실행기와 사용자가 관리한다.
- 패키지를 설치하지 마라. 이유: 이 step에는 필요가 없다.
- 기존 테스트를 깨뜨리지 마라.
