# scripts/

하네스 실행기, 훅 가드, 리뷰 게이트가 들어 있는 폴더. 앱 코드(`src/`)와 달리 Python 표준 라이브러리만 쓴다.

## 파일

| 파일 | 역할 |
|---|---|
| `execute.py` | phase의 step을 순서대로 실행한다. step마다 `codex exec`를 새 프로세스로 띄우고 재시도, 커밋, 타임스탬프 기록을 맡는다. |
| `tdd_guard.py` | 파일 수정 전 훅. 대응 테스트가 먼저 변경되지 않은 구현 파일 수정을 막는다. |
| `bash_guard.py` | 셸 실행 전 훅. 되돌리기 어려운 명령어 패턴을 막는다. |
| `review_gate.py` | `/review-code` 스킬을 헤드리스로 돌리고 판정에 따라 커밋·PR을 막는다. PR에서는 자동 머지·직접 판단·닫기도 정한다. pre-commit 훅과 GitHub Action이 같이 쓴다. |
| `oncall.py` | CI 실패를 고치는 `/oncall` 스킬의 앞뒤 단계. `prepare`는 깨어나도 되는 실패인지 확인하고 실패한 job의 로그를 가려서 준비한다. `publish`는 에이전트가 넘긴 보고와 패치로 수정 PR을 연다. GitHub Action이 쓴다. |
| `test_*.py` | 위 다섯 파일의 pytest 테스트. |

## 명령어

```bash
python3 scripts/execute.py <phase-dir> [--push]   # phase 실행
python3 scripts/review_gate.py --staged           # staged 변경 리뷰 (pre-commit 훅이 실행)
python3 scripts/oncall.py prepare <run-id>        # 실패한 CI job의 로그 준비 (oncall job이 실행)
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
- PR의 워크플로우는 PR 쪽 워크플로우 파일, `review_gate.py`, 리뷰 규칙으로 돈다. 그래서 `auto-merge` job은 리뷰·CI 설정과 의존성(워크플로우의 `PROTECTED` 경로)을 고친 PR을 머지하지 않는다. `PROTECTED`를 바꾸면 루트 `CLAUDE.md`의 목록도 고친다.
- 워크플로우 파일을 고쳐 `PROTECTED` 검사를 지운 PR은 이 검사로 막을 수 없다. 그런 PR은 `GITHUB_TOKEN`에 `workflows` 권한이 없어 머지가 거부된다는 GitHub의 제한에 기댄다. 이 저장소에서 직접 확인한 적은 없다. 이 장치는 리뷰 설정을 고친 PR이 사람 확인 없이 들어가는 것을 막을 뿐, 저장소에 push할 수 있는 사람을 막지 않는다. `main` 보호는 `review-code` 체크뿐이고 승인은 필수가 아니다.
- 워크플로우의 job 이름 `review-code`는 `main` 브랜치 보호의 필수 체크 이름이다. 바꾸지 않는다.
- 리뷰 세션에 허용하는 도구는 `review_gate.py`의 `ALLOWED_TOOLS`뿐이다. 프로젝트 안의 파일 읽기와 읽기 전용 명령은 규칙 없이도 실행된다. `Read`나 `Bash(git *)` 같은 넓은 규칙을 더하면 프로젝트 밖 파일(환경변수의 토큰 등)과 쓰기 명령이 열리므로 더하지 않는다.
- `review_gate.py`는 보고를 출력하기 전에 `sk-ant-`로 시작하는 문자열을 가린다. CI에서는 보고가 PR 댓글로 공개된다.
- `oncall.py`는 워크플로우의 `oncall`과 `oncall-publish` job이 실행한다. `test` job이 실패했을 때만 깨어나고, 순서는 `prepare` → `claude -p "/oncall ci"` → 재검증과 패치 묶기(`Handoff` 단계) → `publish`다.
- 에이전트가 도는 `oncall` job은 테스트를 실행하므로 임의 코드가 돌 수 있다. 그래서 그 job에는 읽기 권한만 주고, 에이전트 단계에는 `GH_TOKEN`도 주지 않는다. 그 job이 내놓은 보고와 패치는 `oncall-publish`가 새로 체크아웃한 곳에서 데이터로만 다룬다. 시크릿 가리기와 패치 검사를 `publish`에 두는 이유다. `oncall` job 안에 검사를 더해도 에이전트가 우회할 수 있다.
- `publish`는 브랜치 이름, PR 제목, 커밋 메시지를 호출자가 넘긴 값으로만 만든다. 워크플로우는 그 값을 artifact가 아니라 `github.*`에서 가져온다. 에이전트가 쓴 글은 `redact`를 거쳐 PR 본문과 job summary에만 들어간다.
- 무한루프는 세 곳에서 끊는다. `GITHUB_TOKEN`으로 연 PR의 워크플로우 실행은 `action_required`로 만들어져 사람이 승인하기 전에는 돌지 않는다. 워크플로우의 `if`가 `oncall/` 브랜치와 봇을 건너뛴다. `skip_reason`이 on-call 커밋 직후의 실패와 on-call PR이 열려 있는 브랜치를 건너뛴다. 토큰을 PAT이나 GitHub App으로 바꾸면 첫째가 사라지므로 나머지 둘을 지우지 않는다.
- 에이전트 단계의 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`은 Bash 도구와 훅의 환경에서 토큰을 지우고 Bash를 격리된 PID 네임스페이스에서 돌린다. 에이전트가 돌리는 테스트는 의존성 코드를 실행하므로, 이 값이 없으면 그 코드가 `CLAUDE_CODE_OAUTH_TOKEN`을 물려받는다. Linux에서는 `bubblewrap`이 없으면 `claude`가 시작하지 않고, `socat`이 없으면 세션 안의 Bash가 뜨지 않는다. ubuntu-24.04 러너는 AppArmor가 사용자 네임스페이스를 막아 `bubblewrap`이 `Permission denied`로 죽으므로 `Install agent` 단계가 그 제한을 푼다. macOS에서는 이 셋 없이도 돌아서 로컬 시험으로는 드러나지 않는다.
- 그 샌드박스 안에서는 lint와 test는 돌지만 `npm run build`가 권한 오류로 실패한다. 에이전트의 보고에 따르면 CSS 처리 단계가 읽을 수 없는 `.bashrc`에 걸린다. 정확한 원인은 확인하지 않았다. 그래서 build는 세션 밖의 `Reproduce`와 `Handoff` 단계에서만 확인된다. build 단계의 실패는 에이전트가 세션 안에서 재현하지 못하고 로그로만 판단한다.
- 러너의 `gh`는 이스케이프 문자가 든 응답을 `--allow-escape-sequences` 없이는 출력하지 않는다. CI 로그에는 항상 색 코드가 있다. 옛 `gh`에는 이 옵션이 없어서 `_job_log`가 옵션 없이 다시 시도한다.
- `Fix` 단계는 에이전트의 출력을 로그에 찍지 않는다. 실행 정보 한 줄과, 실패했을 때 CLI의 오류 줄만 남긴다. `Handoff` 단계는 보고서도 패치도 없으면 job을 실패시킨다. 끝까지 돈 에이전트는 고치지 않았더라도 보고서를 남기기 때문이다.
- Actions의 기본 셸은 `pipefail` 없는 `bash -e`다. `oncall.py`의 출력을 `tee`로 잇는 단계에는 `shell: bash`를 줘야 스크립트의 실패가 단계의 실패가 된다.
- `skip_reason`은 on-call 커밋을 제목 `fix(oncall):`, 트레일러 `Oncall-Run:`, 브랜치 이름 `oncall/ci-fix-`로 알아본다. `publish`가 만드는 제목·트레일러·브랜치 이름을 바꾸면 `ONCALL_COMMIT`도 고친다.
- `has_secret`에는 접두사가 뚜렷한 패턴만 둔다. `이름=값` 규칙(`ASSIGNMENT`)을 넣으면 `token_hash=` 같은 평범한 코드에 걸려 인증 코드를 고친 패치를 열 수 없다.
- `ONCALL_ACTIVE=1`이면 `tdd_guard.py`가 통과시킨다. 워크플로우가 on-call 세션에 세운다. 실패한 CI가 테스트 선행을 대신한다고 보기 때문이다.
- on-call PR은 `GITHUB_TOKEN`으로 열기 때문에 저장소 설정 "Allow GitHub Actions to create and approve pull requests"가 켜져 있어야 한다. 꺼져 있으면 `publish`가 올린 브랜치를 지우고 실패한다.
- Codex는 루트에서 실행 폴더까지의 `AGENTS.md`만 자동으로 읽는다. 저장소 루트에서 실행한 세션은 이 파일을 자동으로 읽지 않는다.
