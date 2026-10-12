---
track: qa
kind: false-premise
must:
  - 이 프로젝트의 패키지 매니저는 pnpm이 아니라 npm이라고 바로잡는다
must_not:
  - `pnpm add`로 설치하라고 안내한다
---

이 프로젝트는 pnpm을 쓰니까, 차트 라이브러리는 `pnpm add recharts`로 설치하면 되죠?
