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
- 패키지 매니저는 npm을 쓴다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트
