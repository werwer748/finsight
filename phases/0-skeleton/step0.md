# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/.claude/settings.json` (Stop 훅과 PreToolUse 훅이 어떤 명령을 실행하는지 확인)
- `/scripts/tdd_guard.py` (어떤 경로의 파일이 테스트 선행을 요구하는지 확인)
- `/.gitignore`

이 저장소에는 아직 앱 코드가 없다. 이 step이 Next.js 프로젝트의 뼈대를 만든다.

## 작업

저장소 루트에 Next.js 프로젝트와 테스트 환경을 구성한다. 기능은 만들지 않는다.

### 1. Next.js 프로젝트 생성

`create-next-app`은 비어 있지 않은 폴더에서 실패한다. 임시 폴더(`mktemp -d`)에 생성한 뒤 필요한 파일만 저장소 루트로 옮겨라.

```bash
npx create-next-app@latest <임시폴더>/app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-agents-md --disable-git --yes
```

플래그가 설치된 버전과 다르면 `npx create-next-app@latest --help`로 확인해 같은 구성(TypeScript, Tailwind CSS, ESLint, App Router, `src/` 폴더, `@/*` alias, npm)이 되도록 맞춰라.

옮길 때의 규칙:

- 옮기지 않는 것: `.git`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `node_modules`.
- `.gitignore`는 덮어쓰지 말고 병합한다. 기존 줄(`phases/**/...-output.json`, `__pycache__/` 등)을 유지하고 생성된 규칙을 추가한다. `.env*`가 무시되도록 하되 `.env.example`은 추적되게 `!.env.example`을 추가한다.
- 옮긴 뒤 루트에서 `npm install`을 실행해 `package-lock.json`을 만든다.
- `package.json`의 `name`은 `finsight`로 한다.

### 2. 보일러플레이트 정리

- `src/app/layout.tsx`: `<html lang="ko">`, metadata는 title `FinSight`, description `거래 내역 파일만 올리면 소비가 한눈에`. Google Fonts(Geist) 로딩 코드를 제거한다 (빌드가 외부 네트워크에 의존하지 않게 하고, 폰트는 다음 step에서 시스템 폰트로 정한다).
- `src/app/page.tsx`: 기본 내용을 지우고 서비스 이름 `FinSight`를 `<h1>`으로 보여주는 최소 페이지로 바꾼다. 랜딩 페이지는 step 2에서 만든다.
- `src/app/globals.css`: Tailwind import만 남기고 다크 모드 관련 기본 스타일을 지운다.
- `public/`의 기본 SVG 이미지처럼 더 이상 쓰이지 않는 파일을 지운다.

### 3. 테스트 환경

Vitest와 Testing Library를 설치하고 설정한다.

- devDependencies: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`
- `vitest.config.ts`: 환경 `jsdom`, `@/*` alias가 `src/*`로 해석되게 설정, setup 파일 등록.
- `vitest.setup.ts`: `@testing-library/jest-dom/vitest`를 import.
- `package.json` scripts:
  - `"test": "vitest run"` (watch 모드가 아니어야 한다)
  - `dev`, `build`, `lint`는 create-next-app이 만든 그대로 둔다.
- 첫 테스트 `src/app/page.test.tsx`: 홈 페이지를 렌더링해 `FinSight` 제목이 보이는지 확인한다. 이 테스트가 jsdom, TSX 변환, alias 설정이 동작함을 증명한다.

### 4. 환경변수 예시 파일

루트에 `.env.example`을 만든다.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
python3 -m pytest scripts/ -q
test -z "$(git status --porcelain -- CLAUDE.md docs scripts .claude)"   # 기존 하네스 파일이 바뀌지 않았다
git check-ignore -q .env.local                                          # .env.local 은 무시된다
! git check-ignore -q .env.example                                      # .env.example 은 추적된다
test ! -e AGENTS.md
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-skeleton/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (설치된 Next.js·Vitest 버전과 테스트 설정 파일 경로를 포함하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `CLAUDE.md`, `docs/`, `scripts/`, `.claude/`를 수정하거나 덮어쓰지 마라. 이유: 하네스의 가드레일이고 create-next-app이 기본으로 `CLAUDE.md`와 `AGENTS.md`를 생성하기 때문에 실수로 덮어쓰기 쉽다.
- `rm -rf`를 쓰지 마라. 이유: PreToolUse 훅이 차단한다. 임시 폴더는 시스템 임시 디렉토리에 두고 지우지 않아도 된다.
- pnpm, yarn, bun을 쓰지 마라. 이유: 훅과 CLAUDE.md의 명령어가 npm 기준이다.
- create-next-app이 설치한 `next`, `react`, `typescript`, `tailwindcss` 버전을 임의로 올리거나 내리지 마라. 이유: 서로 호환되는 조합으로 설치된다.
- UI 컴포넌트 라이브러리, 상태 관리 라이브러리, Supabase 등 이 step에 적히지 않은 패키지를 설치하지 마라. 이유: 이후 step에서 필요할 때 추가한다.
- 빈 폴더를 만들기 위한 `.gitkeep` 파일을 만들지 마라. 이유: `src/components` 등은 파일이 생길 때 만들어진다.
- 랜딩 페이지, 로그인, 대시보드를 만들지 마라. 이유: 이후 step의 범위다.
