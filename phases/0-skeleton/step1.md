# Step 1: ui-foundation

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` (디자인 섹션)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-008, ADR-009)
- `/scripts/tdd_guard.py`
- `/package.json`, `/vitest.config.ts`, `/vitest.setup.ts`
- `/src/app/layout.tsx`, `/src/app/globals.css`, `/src/app/page.tsx`, `/src/app/page.test.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

디자인 토큰과 공용 기본 컴포넌트 3개를 만든다. 이후 모든 화면이 이것만으로 조립된다.

### 1. 디자인 토큰 (`src/app/globals.css`)

Tailwind CSS 4의 `@theme`으로 아래 토큰을 정의한다. 방향은 밝고 깔끔한 핀테크풍이고 라이트 모드만 지원한다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--color-background` | `#ffffff` | 페이지 배경 |
| `--color-surface` | `#f9fafb` | 옅은 구역 배경 |
| `--color-foreground` | `#111827` | 본문 글자 |
| `--color-muted` | `#6b7280` | 보조 글자 |
| `--color-border` | `#e5e7eb` | 테두리 |
| `--color-primary` | `#2563eb` | 포인트 색 (버튼, 링크) |
| `--color-primary-hover` | `#1d4ed8` | 포인트 색 hover |
| `--color-danger` | `#dc2626` | 오류 |

- 폰트는 시스템 폰트 스택을 쓴다: `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", "Segoe UI", sans-serif`.
- `body`에 배경색, 글자색, 폰트를 적용한다.
- 모서리 반경 토큰을 하나 정의해 버튼, 입력, 카드가 같은 값을 쓴다.

### 2. 공용 컴포넌트 (`src/components/ui/`)

구현 파일을 쓰기 전에 같은 폴더에 테스트 파일을 먼저 작성하라. `tdd_guard.py` 훅이 테스트 없는 구현 파일 작성을 차단한다.

`button.tsx`

```ts
type ButtonStyleProps = {
  variant?: "primary" | "secondary" | "ghost"; // 기본 "primary"
  size?: "md" | "lg";                           // 기본 "md"
  fullWidth?: boolean;
};

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps
): React.JSX.Element;

// 버튼처럼 보이는 내부 링크. next/link 를 감싼다.
export function ButtonLink(
  props: { href: string; children: React.ReactNode; className?: string } & ButtonStyleProps
): React.JSX.Element;
```

`input.tsx`

```ts
export function Input(
  props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
): React.JSX.Element;
```

- `label`은 `<label>`로 렌더링하고 입력과 연결한다 (`useId`로 id 생성, 호출부가 `id`를 주면 그 값을 쓴다).
- `error`가 있으면 입력 아래에 오류 문구를 보여주고 `aria-invalid`와 `aria-describedby`를 설정한다.

`card.tsx`

```ts
export function Card(
  props: { children: React.ReactNode; className?: string }
): React.JSX.Element;
```

- 흰 배경, 테두리, 반경, 안쪽 여백을 가진 단순한 컨테이너다.

### 3. 테스트

클래스 이름이 아니라 동작과 접근성을 검증한다.

- `button.test.tsx`: 클릭 시 `onClick` 호출, `disabled`일 때 호출되지 않음, `type` 등 버튼 속성 전달. `ButtonLink`는 주어진 `href`를 가진 링크로 렌더링됨.
- `input.test.tsx`: 라벨 텍스트로 입력을 찾을 수 있음, `error`가 있으면 문구가 보이고 `aria-invalid`가 설정됨, 값 입력이 동작함.
- `card.test.tsx`: 자식 내용을 렌더링함.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -f src/components/ui/button.test.tsx && test -f src/components/ui/input.test.tsx && test -f src/components/ui/card.test.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-skeleton/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (컴포넌트 경로와 export 이름, 토큰 이름을 포함하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- UI 컴포넌트 라이브러리나 클래스 병합 유틸(`shadcn`, `radix`, `clsx`, `tailwind-merge` 등)을 설치하지 마라. 이유: ADR-009에 따라 Tailwind로 직접 만든다.
- 다크 모드 스타일을 넣지 마라. 이유: PRD가 라이트 모드만 지원한다.
- 위 3개 외의 컴포넌트(모달, 테이블, 토스트 등)를 만들지 마라. 이유: 필요한 step에서 만든다.
- 웹 폰트를 내려받거나 `next/font/google`을 쓰지 마라. 이유: 빌드가 외부 네트워크에 의존하지 않게 한다.
- `src/app/page.tsx`의 내용을 바꾸지 마라. 이유: 랜딩은 step 2의 범위다.
- 기존 테스트를 깨뜨리지 마라.
