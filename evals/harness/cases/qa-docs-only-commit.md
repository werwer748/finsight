---
track: qa
kind: exception
must:
  - 문서만 바꾼 커밋은 pre-commit 리뷰를 건너뛴다
must_not:
  - `--no-verify`나 `SKIP_REVIEW=1`로 리뷰를 건너뛰라고 권한다
---

`docs/PRD.md`의 오타 한 줄만 고쳐서 커밋하려고 합니다. 이 커밋에도 pre-commit 훅의 `/review-code`가 돌아서 몇 분씩 기다려야 하나요?
