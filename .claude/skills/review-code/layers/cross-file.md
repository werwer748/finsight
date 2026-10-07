# cross-file — 파일 간 정합성

변경된 파일만 보면 멀쩡하지만 다른 파일과 맞춰 보면 어긋나는 것을 찾는다. 이 차원은 diff 밖의 파일을 읽어야 한다.

## 본다

- 변경된 것을 쓰는 쪽과, 변경된 것이 기대는 쪽.

## 보지 않는다

- 한 파일 안의 로직 오류 → correctness
- 파일이 맞는 레이어에 있는지 → architecture
- UI 가이드 문서 갱신 → conventions

## 읽을 문서

- 변경된 export를 Grep으로 찾아 나온 사용처
- `scripts/AGENTS.md`: `scripts/`, `.claude/settings.json`, `.codex/hooks.json`이 바뀌었을 때만

## 체크 항목

1. 함수 시그니처, 타입, export 이름이 바뀌었는데 사용처가 그대로인가?
2. 파일을 지우거나 옮겼는데 import하는 곳이 남았는가?
3. 타입 정의(`src/types/`), 그 타입을 만들거나 읽는 코드, DB 마이그레이션의 컬럼이 서로 맞는가?
4. 같은 값(카테고리 목록, 경로, 한도 숫자, 금액)을 두 곳에서 따로 정의해 어긋나는가?
5. mock이 실제 모듈의 현재 시그니처와 같은가?
6. 코드가 바뀌었는데 그 동작을 설명하는 문서(`docs/ARCHITECTURE.md`, `docs/ADR.md`, `CLAUDE.md`)가 그대로인가? 또는 문서만 바뀌었는가?
7. 훅 등록 파일(`.claude/settings.json`, `.codex/hooks.json`) 중 한쪽만 바뀌었는가?
8. 환경변수를 새로 쓰는데 `.env.example`에 없는가?
9. 라우트 경로가 바뀌었는데 링크, 리다이렉트, `src/lib/auth/routes.ts`의 목록이 그대로인가?
