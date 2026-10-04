# Step 2: landing

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (목표, 사용자, 디자인, 개발 단계)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/scripts/tdd_guard.py`
- `/src/app/layout.tsx`, `/src/app/globals.css`
- `/src/app/page.tsx`, `/src/app/page.test.tsx`
- `/src/components/ui/button.tsx`, `/src/components/ui/card.tsx` 와 각 테스트 파일

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`/` 경로의 랜딩 페이지를 만든다. 구성은 헤더, 히어로, 푸터 세 부분뿐이다.

### 1. 컴포넌트 (`src/components/landing/`)

구현 파일보다 테스트 파일을 먼저 작성하라. 모두 props가 없는 동기 서버 컴포넌트다.

```ts
// header.tsx
export function LandingHeader(): React.JSX.Element;
// hero.tsx
export function Hero(): React.JSX.Element;
// footer.tsx
export function LandingFooter(): React.JSX.Element;
```

- `LandingHeader`: 왼쪽에 서비스 이름 `FinSight`(`/`로 가는 링크), 오른쪽에 `로그인` 링크(`/login`)와 `시작하기` 버튼(`/signup`).
- `Hero`:
  - 제목(`<h1>`): `거래 내역 파일만 올리면, 소비가 한눈에`
  - 설명: `은행·카드사에서 내려받은 CSV, Excel 파일을 올리면 자동으로 분류해 대시보드로 보여드려요.`
  - 주 버튼: `무료로 시작하기` → `/signup` (`ButtonLink`, size `lg`)
  - 보조 문구: `이미 계정이 있나요?` 와 `로그인` 링크 → `/login`
- `LandingFooter`: `© 연도 FinSight`. 연도는 실행 시점의 연도를 쓴다.

스타일은 step 1의 토큰과 `ButtonLink`를 쓴다. 넉넉한 여백과 큰 제목으로 구성하고, 모바일 폭(360px)에서도 가로 스크롤 없이 보이게 한다.

### 2. 페이지 (`src/app/page.tsx`)

세 컴포넌트를 조합만 한다. 페이지 안에 `<h1>`은 히어로의 제목 하나만 있어야 한다.

### 3. 테스트

- `header.test.tsx`: `로그인` 링크의 href가 `/login`, `시작하기`의 href가 `/signup`.
- `hero.test.tsx`: 제목과 설명이 보이고, `무료로 시작하기`의 href가 `/signup`, `로그인` 링크의 href가 `/login`.
- `footer.test.tsx`: `FinSight`가 포함된 저작권 문구가 보임. 연도를 하드코딩해 비교하지 마라.
- `src/app/page.test.tsx`: step 0의 테스트를 새 내용에 맞게 고친다 (히어로 제목이 보이는지 확인).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -f src/components/landing/hero.test.tsx && test -f src/components/landing/header.test.tsx && test -f src/components/landing/footer.test.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-skeleton/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 가격표, 기능 소개, FAQ, 후기 섹션을 만들지 마라. 이유: 랜딩 구성은 히어로와 가입 버튼으로 확정됐다.
- 샘플 데이터 체험 버튼이나 페이지를 만들지 마라. 이유: 대시보드가 생기는 Phase 1에서 붙인다.
- `/login`, `/signup` 페이지를 만들지 마라. 이유: step 4의 범위다. 지금은 링크가 404여도 된다.
- 이미지 파일이나 아이콘 라이브러리를 추가하지 마라. 이유: 이 step은 텍스트와 버튼만으로 구성한다.
- 클라이언트 컴포넌트(`"use client"`)를 만들지 마라. 이유: 이 페이지에는 인터랙션이 없다.
- 기존 테스트를 깨뜨리지 마라.
