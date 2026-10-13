# scripts/

하네스 실행기, 훅 가드, 리뷰 게이트가 들어 있는 폴더. 앱 코드(`src/`)와 달리 Python 표준 라이브러리만 쓴다.

## 파일

| 파일 | 역할 |
|---|---|
| `execute.py` | phase의 step을 순서대로 실행한다. step마다 `codex exec`를 새 프로세스로 띄우고 재시도, 커밋, 타임스탬프 기록을 맡는다. |
| `tdd_guard.py` | 파일 수정 전 훅. 대응 테스트가 먼저 변경되지 않은 구현 파일 수정을 막는다. |
| `bash_guard.py` | 셸 실행 전 훅. 되돌리기 어려운 명령어 패턴을 막는다. |
| `review_gate.py` | `/review-code` 스킬을 헤드리스로 돌리고 판정에 따라 커밋·PR을 막는다. PR에서는 자동 머지·직접 판단·닫기도 정한다. pre-commit 훅과 GitHub Action이 같이 쓴다. |
| `oncall.py` | `/oncall` 스킬의 앞뒤 단계. `prepare`는 깨어나도 되는 실패인지 확인하고 실패한 job의 로그를 가려서 준비한다. `publish`는 에이전트가 넘긴 보고와 패치로 수정 PR을 연다. 이 둘은 GitHub Action이 쓴다. `ask`는 질문 하나를 읽기 전용 세션에 넘기고 돌아온 답의 근거를 검사해 초안으로 남긴다. 사람이 로컬에서 실행한다. |
| `ask_guard.py` | MCP 호출 전 훅. `/oncall ask` 세션에서 허용 목록에 든 DB 쿼리와 PostHog 읽기만 통과시키고 결정을 기록한다. 다른 세션에서는 아무것도 하지 않는다. |
| `test_*.py` | 위 여섯 파일의 pytest 테스트. |

## 명령어

```bash
python3 scripts/execute.py <phase-dir> [--push]   # phase 실행
python3 scripts/review_gate.py --staged           # staged 변경 리뷰 (pre-commit 훅이 실행)
python3 scripts/oncall.py prepare <run-id>        # 실패한 CI job의 로그 준비 (oncall job이 실행)
python3 scripts/oncall.py ask --audience user "<질문>"   # 질문에 근거로 답한 초안 쓰기 (로컬에서 실행)
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
- 그 격리의 경계는 세션의 Bash 도구까지다. 같은 job의 `npm ci`(설치 스크립트)와 `Reproduce`, 그리고 세션이 멈출 때 도는 Stop 훅은 격리 밖에서 의존성 코드를 실행한다. 환경변수만 훑는 코드는 토큰을 얻지 못하지만, 백그라운드에 남아 `claude` 프로세스의 `/proc/<pid>/environ`을 읽거나 `$GITHUB_PATH`를 바꿔치기하는 표적형 코드는 막지 못한다. 러너에서 실제로 되는지는 확인하지 않았다. 막으려면 토큰을 받는 job에서 격리 밖 실행을 없애야 한다: `Reproduce`를 시크릿 없는 job으로 옮기고, `npm ci --ignore-scripts`로 설치하고, on-call 세션에서 Stop 훅을 건너뛴다. 아직 하지 않았다.
- 수정 범위는 제한하지 않는다. 대신 패치가 리뷰·CI 설정이나 의존성(`PROTECTED`)을 고치면 `publish`가 PR 본문에 경고를 넣는다. on-call PR의 워크플로우를 승인하면 그 PR이 고친 판의 `scripts/review_gate.py`가 `CLAUDE_CODE_OAUTH_TOKEN`과 함께 실행되기 때문이다. `PROTECTED`는 워크플로우 `auto-merge` job의 것과 같아야 하고 `test_oncall.py`가 확인한다.
- 러너의 `gh`는 이스케이프 문자가 든 응답을 `--allow-escape-sequences` 없이는 출력하지 않는다. CI 로그에는 항상 색 코드가 있다. 옛 `gh`에는 이 옵션이 없어서 `_job_log`가 옵션 없이 다시 시도한다.
- `Fix` 단계는 에이전트의 출력을 로그에 찍지 않는다. 실행 정보 한 줄과, 실패했을 때 CLI의 오류 줄만 남긴다. `Handoff` 단계는 보고서도 패치도 없으면 job을 실패시킨다. 끝까지 돈 에이전트는 고치지 않았더라도 보고서를 남기기 때문이다.
- Actions의 기본 셸은 `pipefail` 없는 `bash -e`다. `oncall.py`의 출력을 `tee`로 잇는 단계에는 `shell: bash`를 줘야 스크립트의 실패가 단계의 실패가 된다.
- `skip_reason`은 on-call 커밋을 제목 `fix(oncall):`, 트레일러 `Oncall-Run:`, 브랜치 이름 `oncall/ci-fix-`로 알아본다. `publish`가 만드는 제목·트레일러·브랜치 이름을 바꾸면 `ONCALL_COMMIT`도 고친다.
- `has_secret`에는 접두사가 뚜렷한 패턴만 둔다. `이름=값` 규칙(`ASSIGNMENT`)을 넣으면 `token_hash=` 같은 평범한 코드에 걸려 인증 코드를 고친 패치를 열 수 없다.
- `ONCALL_ACTIVE=1`이면 `tdd_guard.py`가 통과시킨다. 워크플로우가 on-call 세션에 세운다. 실패한 CI가 테스트 선행을 대신한다고 보기 때문이다.
- on-call PR은 `GITHUB_TOKEN`으로 열기 때문에 저장소 설정 "Allow GitHub Actions to create and approve pull requests"가 켜져 있어야 한다. 꺼져 있으면 `publish`가 올린 브랜치를 지우고 실패한다.
- Codex는 루트에서 실행 폴더까지의 `AGENTS.md`만 자동으로 읽는다. 저장소 루트에서 실행한 세션은 이 파일을 자동으로 읽지 않는다.
- `oncall.py ask`는 `claude -p "/oncall ask"`를 읽기 전용으로 띄운다. 순서는 질문 가리기와 `.oncall/ask/question.json` 쓰기 → 세션 → 근거 검사 → `.oncall/ask/answer.md`다. 답을 보내는 코드는 없다. 사용자에게 가는 글은 사람이 `answer.md`를 읽고 승인한 뒤 직접 보낸다.
- ask 세션에는 `Bash`를 통째로 막는다(`ASK_DENIED`). 읽기 전용 셸 명령은 `dontAsk`에서 규칙 없이 실행되고 `Read` 거부 규칙은 `cat .env.local`을 막지 못하기 때문이다. 코드는 Read·Grep·Glob으로만 읽는다. 더 여는 도구는 MCP 둘(`ASK_ALLOWED`)뿐이다.
- `ONCALL_ASK_ACTIVE=1`은 `oncall.py ask`가 세션에 세우는 값이다. 이 값이 있어야 `ask_guard.py`가 켜진다. `ONCALL_ACTIVE`가 가드를 푸는 값인 것과 방향이 반대다. 그래서 `claude -p "/oncall ask"`를 직접 부르는 방법은 어디에도 적지 않는다. 직접 부른 세션은 `question.json`이 없어 스킬의 첫 단계에서 멈춘다. `ask`가 실행 뒤에 그 파일을 지우는 이유다.
- 같은 값으로 Stop 훅이 lint·build·test를 건너뛴다. ask 세션은 파일을 고칠 수 없어서, 실패를 알리면 그 출력이 구조화된 답 자리에 들어간다.
- `ask_guard.py`는 켜져 있을 때 닫힌 쪽으로 실패한다. 훅은 exit 2일 때만 호출을 막으므로 읽지 못한 입력, 모르는 도구, 기록 실패를 모두 exit 2로 끝낸다. 예외로 끝나면(exit 1) 호출이 통과한다.
- DB 쿼리는 `ask_guard.py`의 `SQL_TEMPLATES`와 글자 단위로 같아야 통과한다. Supabase MCP의 role은 쓰지는 못하지만 RLS를 우회해 모든 사용자의 원본 행을 읽는다. 그래서 쿼리를 통째로 고정했고, 돌려주는 열을 건수·날짜와 시각의 최솟값과 최댓값·불리언으로 제한했다. `category`처럼 사용자가 쓴 글이 담기는 열을 돌려주는 템플릿은 더하지 않는다. 템플릿의 user id는 호출자가 `ONCALL_ASK_USER_ID`로 묶은 값 하나뿐이라 질문에 적힌 다른 id로는 조회되지 않는다.
- 템플릿을 바꾸면 `.claude/skills/oncall/ask.md`의 SQL 블록도 같이 바꾼다. `test_ask_guard.py`가 둘이 같은지 본다.
- PostHog는 `mcp__posthog__exec` 하나로 읽기와 쓰기를 모두 한다. 가드는 `POSTHOG_TOOLS`에 든 도구의 `info`·`schema`·`call`만 통과시키고, `call`의 조회 조건도 그 표에 적힌 키만 받는다. 사람 목록이나 이메일, 스택과 변수 값을 돌려주는 도구와 `execute-sql`, 프로젝트에 저장된 지시문을 불러오는 `learn`은 넣지 않는다. 사람이나 세션으로 좁히는 키(`user`, `personId`, `sessionId`)와 이메일까지 뒤지는 `searchQuery`도 넣지 않는다. 키를 더하면 `ask.md`에도 적는다.
- 훅은 결정마다 `.oncall/ask/guard.log`에 `allow|block`, 도구 이름, 템플릿이나 PostHog 도구 이름을 남긴다. 쿼리 글은 남기지 않는다. `ask`는 `db`·`log` 근거가 이 기록의 allow 줄과 맞는지 본다. 허용된 적 없는 조회를 근거로 댄 답과, 훅이 로드되지 않은 세션의 답이 여기서 걸린다. 기록은 호출 전에 남으므로 허용된 뒤 오류로 끝난 호출과 성공한 호출을 구분하지 못한다. `claude -p`는 검증에 실패한 설정 파일을 알리지 않고 무시한다. 그러면 가드 없이 MCP 도구가 열린다. 그래서 `ask_guard.py`를 SessionStart 훅으로도 등록해 세션이 시작될 때 `armed` 줄을 남기고, `ask`는 그 줄이 없는 세션의 답을 조회 근거가 있든 없든 버린다. `.claude/settings.json`을 고친 뒤에는 질문을 한 번 돌려 답이 버려지지 않는지 확인한다.
- 파일 근거는 저장소가 추적하는 파일(`git ls-files`)의 줄이고 `quote`가 그 줄의 앞뒤 2줄 안에 있어야 통과한다. `.git/config`, 빌드 산출물, `.env*`(대소문자 무관)는 받지 않는다. 이 검사는 그 줄이 있다는 것까지만 보장한다. 그 줄이 주장을 뒷받침하는지는 승인하는 사람이 `answer.md`의 근거에서 본다. 그래서 근거에는 모델이 적은 인용이 아니라 `ask`가 파일에서 읽은 줄을 싣는다.
- `--user-id`는 실행한 사람이 정한 값이다. 질문자가 그 계정의 주인이라는 증명이 아니다. 사용자에게 가는 초안에 계정 정보가 들어가면 `answer.md`가 본인 확인을 요구한다.
- `ask`는 Supabase와 PostHog MCP가 등록된 머신에서만 돈다. 둘은 저장소가 아니라 개발 머신의 Claude Code 로컬 설정에, 이 체크아웃 경로로 등록되어 있다. worktree와 CI에는 없다. 상시로 돌리려면 집계 뷰만 읽는 DB role과 읽기 범위의 PostHog 키가 따로 필요하다.
- `ask_guard.py`는 `.codex/hooks.json`에 등록하지 않는다. ask 세션은 `claude`로만 띄운다.
- `ask`는 질문에서 시크릿, 10자리 이상 숫자열과 4자리 네 묶음, 이메일을 가린 뒤에 세션에 넘긴다. 숫자와 이메일의 경계는 `\b`가 아니라 글자 종류로 본다. 한글은 `\w`라서 조사가 바로 붙은 번호에는 낱말 경계가 없다. 이름은 가려내지 못한다. 질문에 적힌 이름은 그대로 LLM과 `answer.md`에 간다.
- `answer.md`에서 질문과 초안은 인용 블록(`> `)으로, 모델이 쓴 한 줄짜리 값은 줄바꿈을 접어서 싣는다. 승인하는 사람은 `## 근거` 같은 절을 `ask`가 쓴 것으로 읽는다. 질문이나 초안의 줄바꿈으로 그 절을 흉내 낼 수 없어야 한다.
