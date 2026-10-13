# 프로젝트: FinSight

은행·카드사에서 내려받은 거래 내역 파일(CSV, Excel)을 올리면 자동으로 분류해 대시보드로 보여주는 한국 개인 사용자용 SaaS.

## 기술 스택
- Next.js 16 (App Router), Vercel 배포
- TypeScript strict mode
- Tailwind CSS 4
- Supabase (Auth + Postgres + RLS)
- Polar (결제)
- Claude API (`claude-haiku-4-5`, `@anthropic-ai/sdk`)
- PostHog (사용 분석, 오류 추적, 서버 로그)
- Vitest + Testing Library

## 아키텍처 규칙
- CRITICAL: 클라이언트 컴포넌트에서 Supabase·Polar·Claude API를 직접 호출하지 말 것. 외부 서비스 호출과 시크릿 키 사용은 서버에서만 실행되는 코드(서버 컴포넌트, 서버 액션, `src/app/api/` 라우트 핸들러, `src/services/`)에서만 한다. 예외는 PostHog 브라우저 SDK(`posthog-js`) 하나다. 공개 프로젝트 토큰만 쓰고, 거래 데이터와 개인정보(이메일 포함)는 보내지 않는다.
- CRITICAL: 금액 합계와 통계는 반드시 코드로 계산할 것. LLM 출력에서 숫자를 가져오지 않는다.
- CRITICAL: LLM에는 가맹점명과 집계된 통계만 보낼 것. 계좌·카드번호, 이름, 원본 거래 행은 보내지 않는다.
- CRITICAL: 사용자 데이터를 담는 테이블은 전부 RLS를 켜고 `user_id`로 격리할 것.
- CRITICAL: 무료/Pro 권한 체크는 서버에서 할 것. 화면에서 숨기는 것만으로 잠그지 않는다.
- CRITICAL: RLS를 우회하는 Supabase secret key(`src/lib/supabase/admin.ts`)는 on-call 웹훅의 `oncall_events` 테이블에만 쓸 것. 사용자 데이터는 로그인 세션 클라이언트로 RLS를 거쳐서만 읽고 쓴다.
- 페이지(`src/app/`)는 얇게 두고, 로직은 `src/lib/`와 `src/services/`, UI는 `src/components/`, 타입은 `src/types/`에 둔다.
- 테스트는 구현 파일과 같은 폴더에 `이름.test.ts` 또는 `이름.test.tsx`로 둔다. `scripts/tdd_guard.py` 훅이 테스트가 먼저 변경되지 않은 구현 파일 수정을 차단한다.
- UI 문구와 오류 메시지는 한국어로 쓴다.
- UI를 만들거나 고칠 때는 `docs/UI_GUIDE.md`를 따른다. 토큰, 컴포넌트 variant, 버튼 문구를 새로 만들거나 바꾸면 같은 변경에서 그 문서도 고친다.
- 패키지 매니저는 npm을 쓴다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)
- `git commit`을 하면 pre-commit 훅이 staged 변경에 `/review-code`를 돌린다. 길면 9분 걸리므로 Bash 제한 시간을 10분으로 준다. 🔴 판정이면 커밋이 막히니 보고를 읽고 고친 뒤 다시 커밋한다. `--no-verify`나 `SKIP_REVIEW=1`로 우회하지 않는다. 문서만 바꾼 커밋은 리뷰를 건너뛴다.
- PR을 올리면 GitHub Action이 lint·build·test와 함께 브랜치 전체에 `/review-code`를 돌려 PR 댓글로 남긴다. 🔴나 🟠 판정이면 체크가 실패한다.
- 리뷰 결과에 따라 PR이 자동으로 처리된다. 🔴·🟠가 없고 🟡가 2건 이하이며 lint·build·test가 통과하면 자동 머지한다. 🔴가 2건 이상이면 PR을 닫는다. 그 밖(🔴 1건, 🟠, 🟡 3건 이상, 리뷰 미완료)은 사람이 판단한다. 자동 머지는 `main`으로 가는 PR만 다룬다. 리뷰·CI 설정과 의존성(`.github/`, `.githooks/`, `.claude/`, `.codex/`, `scripts/`, 모든 `CLAUDE.md`·`CLAUDE.local.md`, `package.json`, `package-lock.json`, `.npmrc`)을 고친 PR은 자동 머지되지 않으니 직접 머지한다.
- PR의 lint·build·test(`test` job)가 실패하면 on-call 에이전트가 깨어나 실패 로그를 읽고 수정 PR(`oncall/ci-fix-…`, base는 실패한 브랜치)을 연다. on-call PR은 자동 머지되지 않으니 직접 리뷰하고 머지한다. 그 PR의 CI와 리뷰는 승인 대기 상태로 만들어진다. 변경 내용을 먼저 확인한 뒤 PR 페이지에서 워크플로우 실행을 승인해야 돈다. 승인하면 그 PR이 고친 판의 스크립트가 시크릿과 함께 실행된다. draft PR, 봇이 연 PR, on-call 수정을 머지한 직후의 실패, on-call PR이 이미 열려 있는 브랜치에는 깨어나지 않는다. 고치지 못하면 PR 없이 실행 요약에 사유만 남긴다. 절차는 `/oncall` 스킬에, 앞뒤 단계는 `scripts/oncall.py`에 있다.
- prod에서 오류가 나면 PostHog error tracking alert(새 이슈, 재발, 급증)가 웹훅(`/api/oncall/posthog`)을 부르고, 웹훅이 `oncall-alert` 워크플로우를 깨운다. 거기서 on-call 에이전트가 노이즈인지 신호인지 판정한다. 노이즈면 실행 요약에 기록만 남기고, 신호면 분석을 담은 Issue(`oncall` 라벨)를 열어 사람을 깨운다. 같은 이슈의 Issue가 열려 있으면 댓글로 단다. 에이전트는 코드와 prod를 고치지 않으니 조치는 직접 한다. 저장소가 공개라 Issue에는 예외 메시지 원문과 사용자 식별자를 싣지 않는다. 노이즈였던 Issue는 `.claude/skills/oncall/known-noise.md`에 항목을 더하고 닫는다. 절차는 `.claude/skills/oncall/alert.md`에, 앞뒤 단계는 `scripts/oncall_alert.py`에 있다.
- on-call 에이전트는 질문에도 답한다(`python3 scripts/oncall.py ask --audience user|team [--user-id <uuid>] "<질문>"`). 코드, PostHog 로그·오류, DB 집계에서 확인한 것만 답하고 확인하지 못한 것은 그렇다고 적는다. 답은 `.oncall/ask/answer.md`에 초안으로 남을 뿐 누구에게도 보내지 않는다. 사용자에게 가는 글은 사람이 읽고 승인한 뒤 직접 보낸다. DB와 PostHog는 읽기만 하고, 구독·계정·데이터를 바꿔야 하는 요청은 실행하지 않고 escalation으로 남긴다. 지금은 MCP가 등록된 개발 머신에서 한 번씩 돌리는 용도다. 절차는 `.claude/skills/oncall/ask.md`에, 조회 허용 목록은 `scripts/ask_guard.py`에 있다.

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
