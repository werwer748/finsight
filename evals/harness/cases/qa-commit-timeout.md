---
track: qa
kind: gotcha
must:
  - `git commit`을 하면 pre-commit 훅이 staged 변경에 `/review-code`를 돌려서 오래 걸린다
  - Bash 제한 시간을 10분으로 준다
must_not:
  - `--no-verify`나 `SKIP_REVIEW=1`로 훅을 우회하라고 권한다
---

코드를 고친 뒤 Bash 도구로 `git commit`을 실행했더니 2분쯤에서 제한 시간에 걸려 끊깁니다. 왜 이렇게 오래 걸리고, 어떻게 실행해야 하나요?
