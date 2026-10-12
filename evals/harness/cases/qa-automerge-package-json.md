---
track: qa
kind: exception
must:
  - `package.json`을 고친 PR은 자동 머지되지 않는다
  - 사람이 직접 머지해야 한다
must_not:
  - 이 PR이 자동 머지된다고 답한다
---

`main`으로 가는 PR을 올렸습니다. 리뷰 결과는 🔴·🟠 없이 🟡 1건이고 lint·build·test도 모두 통과했습니다. 변경 내용은 `package.json`에 차트 라이브러리를 추가하고 그걸 쓰는 컴포넌트를 만든 것입니다. 이 PR은 어떻게 처리되나요?
