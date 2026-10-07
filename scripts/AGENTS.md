# scripts/

하네스 실행기, 훅 가드, 리뷰 게이트가 들어 있는 폴더. 앱 코드(`src/`)와 달리 Python 표준 라이브러리만 쓴다.

## 파일

| 파일 | 역할 |
|---|---|
| `execute.py` | phase의 step을 순서대로 실행한다. step마다 `codex exec`를 새 프로세스로 띄우고 재시도, 커밋, 타임스탬프 기록을 맡는다. |
| `tdd_guard.py` | 파일 수정 전 훅. 대응 테스트가 먼저 변경되지 않은 구현 파일 수정을 막는다. |
| `bash_guard.py` | 셸 실행 전 훅. 되돌리기 어려운 명령어 패턴을 막는다. |
| `review_gate.py` | `/review-code` 스킬을 헤드리스로 돌리고 판정에 따라 커밋·PR을 막는다. PR에서는 자동 머지·직접 판단·닫기도 정한다. pre-commit 훅과 GitHub Action이 같이 쓴다. |
| `test_*.py` | 위 네 파일의 pytest 테스트. |

## 명령어

```bash
python3 scripts/execute.py <phase-dir> [--push]   # phase 실행
python3 scripts/review_gate.py --staged           # staged 변경 리뷰 (pre-commit 훅이 실행)
python3 -m pytest scripts                         # 테스트
```

## 규칙

- 테스트를 먼저 고친다. 테스트는 같은 폴더의 `test_<이름>.py`에 둔다.
- 테스트에서 `codex`, `claude`, `git` 프로세스를 실제로 띄우지 않는다. `subprocess.run`을 mock으로 대체한다.
- 훅 스크립트는 stdin으로 JSON을 받는다. 막을 때는 stderr에 사유를 쓰고 exit 2, 통과면 아무것도 출력하지 않고 exit 0 한다.
- 훅 스크립트는 Claude Code와 Codex의 입력 형식을 모두 받아야 한다.
  - 파일 수정: Claude Code는 `tool_input.file_path`, Codex는 `tool_input.command`에 패치 본문(`*** Add File: <경로>`, `*** Update File: <경로>`)을 준다.
  - 셸 명령: 둘 다 `tool_input.command`에 명령어 문자열을 준다.
- 훅 등록 파일은 `.claude/settings.json`과 `.codex/hooks.json` 두 곳이다. 한쪽을 바꾸면 다른 쪽도 확인한다.
- 출력 메시지와 오류 문구는 한국어로 쓴다.

## 주의

- `execute.py`는 Codex를 샌드박스와 승인 없이 실행한다(`--dangerously-bypass-approvals-and-sandbox`). 실행 중의 방어선은 훅뿐이다.
- step 성공 조건은 `phases/<phase>/index.json`의 status가 `completed`이고 Codex 종료 코드가 0인 것이다. 하나라도 아니면 재시도한다.
- `phases/**/step*-output.json`은 실행 로그이며 커밋하지 않는다. 프롬프트 전문은 로그와 `index.json`에 남기지 않는다.
- `tdd_guard.py`는 프로젝트 루트를 환경변수 `CLAUDE_PROJECT_DIR`에서 읽고, 없으면 훅 입력의 `cwd`를 쓴다. Codex 훅은 이 변수를 git 루트로 채워서 호출한다.
- `review_gate.py`는 `.githooks/pre-commit`과 `.github/workflows/review-code.yml`이 실행한다. git 훅은 `core.hooksPath`가 `.githooks`일 때만 돌고, `npm install`의 `prepare` 스크립트가 이 값을 설정한다.
- `SKIP_REVIEW=1`이면 `review_gate.py`가 리뷰를 건너뛴다. `execute.py`가 step 커밋을 위해 세운다. step에서 만든 코드는 PR 단계에서 한 번에 리뷰한다.
- `REVIEW_GATE_ACTIVE=1`은 `review_gate.py`가 리뷰 세션에 세우는 값이다. `.claude/settings.json`의 Stop 훅이 이 값을 보고 lint·build·test를 건너뛴다.
- `review_gate.py`는 로컬에서 리뷰를 끝내지 못하면 경고만 하고 통과시킨다. pre-commit은 9분(`--timeout 540`)에서 멈춘다. CI는 `--strict`로 실패시킨다.
- `review_gate.py`에 `--decision-output <파일>`을 주면 보고의 건수 줄(`🔴 N · 🟠 N · 🟡 N`)로 머지 판정을 정해 보고 끝에 한 줄로 붙이고 파일에 `decision=<merge|hold|reject>`를 덧붙인다. 🔴 2건 이상은 `reject`, 🔴·🟠 없이 🟡 2건 이하는 `merge`, 나머지와 읽을 수 없는 보고는 `hold`다. 워크플로우가 `$GITHUB_OUTPUT`을 넘겨 `reject`면 PR을 닫고, `merge`면 `test` job까지 통과했을 때 `auto-merge` job이 머지한다.
- PR의 워크플로우는 PR 쪽 `review_gate.py`와 리뷰 규칙으로 돈다. 그래서 `auto-merge` job은 리뷰·CI 설정과 의존성(워크플로우의 `PROTECTED` 경로)을 고친 PR을 머지하지 않는다. 이 검사를 `scripts/`로 옮기지 않는다. PR이 함께 고칠 수 있다. `PROTECTED`를 바꾸면 루트 `CLAUDE.md`의 목록도 고친다.
- 워크플로우의 job 이름 `review-code`는 `main` 브랜치 보호의 필수 체크 이름이다. 바꾸지 않는다.
- 리뷰 세션에 허용하는 도구는 `review_gate.py`의 `ALLOWED_TOOLS`뿐이다. 프로젝트 안의 파일 읽기와 읽기 전용 명령은 규칙 없이도 실행된다. `Read`나 `Bash(git *)` 같은 넓은 규칙을 더하면 프로젝트 밖 파일(환경변수의 토큰 등)과 쓰기 명령이 열리므로 더하지 않는다.
- `review_gate.py`는 보고를 출력하기 전에 `sk-ant-`로 시작하는 문자열을 가린다. CI에서는 보고가 PR 댓글로 공개된다.
- Codex는 루트에서 실행 폴더까지의 `AGENTS.md`만 자동으로 읽는다. 저장소 루트에서 실행한 세션은 이 파일을 자동으로 읽지 않는다.
