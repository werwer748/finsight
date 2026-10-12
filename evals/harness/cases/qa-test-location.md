---
track: qa
kind: convention
must:
  - 테스트 파일은 구현 파일과 같은 폴더에 `summarize.test.ts`로 둔다
  - 테스트가 먼저 변경되지 않으면 `scripts/tdd_guard.py` 훅이 구현 파일 수정을 차단한다
must_not:
  - `__tests__`나 `tests/` 같은 별도 테스트 폴더에 두라고 안내한다
---

`src/lib/dashboard/summarize.ts`에 주간 합계 함수를 추가하려고 합니다. 테스트 파일은 어디에 어떤 이름으로 두나요? 구현부터 고치고 테스트는 나중에 써도 되나요?
