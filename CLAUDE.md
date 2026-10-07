# 프로젝트: FinSight

은행·카드사에서 내려받은 거래 내역 파일(CSV, Excel)을 올리면 자동으로 분류해 대시보드로 보여주는 한국 개인 사용자용 SaaS.

## 기술 스택
- Next.js 16 (App Router), Vercel 배포
- TypeScript strict mode
- Tailwind CSS 4
- Supabase (Auth + Postgres + RLS)
- Polar (결제)
- Claude API (`claude-haiku-4-5`, `@anthropic-ai/sdk`)
- Vitest + Testing Library

## 아키텍처 규칙
- CRITICAL: 클라이언트 컴포넌트에서 Supabase·Polar·Claude API를 직접 호출하지 말 것. 외부 서비스 호출과 시크릿 키 사용은 서버에서만 실행되는 코드(서버 컴포넌트, 서버 액션, `src/app/api/` 라우트 핸들러, `src/services/`)에서만 한다.
- CRITICAL: 금액 합계와 통계는 반드시 코드로 계산할 것. LLM 출력에서 숫자를 가져오지 않는다.
- CRITICAL: LLM에는 가맹점명과 집계된 통계만 보낼 것. 계좌·카드번호, 이름, 원본 거래 행은 보내지 않는다.
- CRITICAL: 사용자 데이터를 담는 테이블은 전부 RLS를 켜고 `user_id`로 격리할 것.
- CRITICAL: 무료/Pro 권한 체크는 서버에서 할 것. 화면에서 숨기는 것만으로 잠그지 않는다.
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
