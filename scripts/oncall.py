#!/usr/bin/env python3
"""
On-call — /oncall 스킬의 앞뒤 단계. CI 실패 수정(prepare, publish)과 질문 응답(ask)을 맡는다.

prepare는 에이전트를 띄우기 전에 실행한다. 깨어나도 되는 실패인지 확인하고, 실패한 CI job의 로그만 받아
시크릿을 가린 뒤 .oncall/failed.log에 둔다.
publish는 에이전트가 끝난 뒤 새로 체크아웃한 곳에서 실행한다. 에이전트가 넘긴 보고와 패치를 데이터로만 다뤄
시크릿을 가리고 수정 브랜치와 PR을 만든다. 머지는 하지 않는다.

에이전트가 도는 job은 테스트를 실행하므로 임의 코드가 돌 수 있다. 그 job이 내놓은 것은 믿지 않고 publish에서 검사한다.
ask는 질문 하나를 읽기 전용 세션에 넘기고, 돌아온 답의 근거를 검사해 .oncall/ask/answer.md에 초안으로 남긴다.
답을 누구에게도 보내지 않는다. 사용자에게 가는 글은 사람이 읽고 승인한 뒤 직접 보낸다.
stdout에는 job summary나 답으로 나갈 글만, stderr에는 진단만 쓴다.

Usage:
    python3 scripts/oncall.py prepare <run-id> [--output <파일>]
    python3 scripts/oncall.py publish <폴더> --base <브랜치> --sha <커밋> --run-id <id> --repo <owner/name>
                                      --step lint|build|test [--attempt <N>] [--pr <번호>]
    python3 scripts/oncall.py ask --audience user|team [--user-id <uuid>] [--timeout <초>] "<질문>"
"""

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import List, Optional, Set, Tuple
from urllib.parse import quote

import ask_guard

# gh가 {owner}와 {repo}를 현재 저장소로 채운다.
API = "repos/{owner}/{repo}"
WORKDIR = Path(".oncall")
BRANCH_PREFIX = "oncall/"
# on-call이 다루는 job과 단계. 리뷰 판정(review-code job)과 npm ci의 실패는 다루지 않는다.
CI_JOBS = ("test",)
STEPS = {"Run npm run lint": "lint", "Run npm run build": "build", "Run npm run test": "test"}
LOG_TAIL = 600
BOT_NAME = "github-actions[bot]"
BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"
TRAILER = "Oncall-Run"
# on-call이 만든 커밋과 그 브랜치를 머지한 커밋. 이런 커밋 직후의 실패에는 다시 깨어나지 않는다.
ONCALL_COMMIT = re.compile(rf"^fix\(oncall\):|^{TRAILER}:|{BRANCH_PREFIX}ci-fix-", re.MULTILINE)

MASK = "***"
# 접두사만으로 시크릿임을 알 수 있는 모양. 패치 검사에도 쓴다.
TOKEN = re.compile("|".join([
    r"sk-ant-[A-Za-z0-9_-]{8,}",
    r"sb_secret_[A-Za-z0-9_-]{8,}",
    r"gh[pousr]_[A-Za-z0-9]{20,}",
    r"github_pat_[A-Za-z0-9_]{20,}",
    r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
    r"whsec_[A-Za-z0-9+/=]{16,}",
    r"polar_[a-z]+_[A-Za-z0-9]{16,}",
    r"phx_[A-Za-z0-9]{16,}",
    r"AKIA[0-9A-Z]{16}",
]))
# END 줄이 잘려 나간 블록은 끝까지 가린다.
PEM = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.DOTALL)
BEARER = re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}", re.IGNORECASE)
URL_CREDENTIALS = re.compile(r"(://[^\s/:@]+):[^\s/@]+@")
# 이름으로 짐작하는 규칙이라 평범한 코드에도 걸린다. 글을 가릴 때만 쓰고 패치 검사에는 쓰지 않는다.
ASSIGNMENT = re.compile(
    r"""((?:SECRET|TOKEN|PASSWORD|PASSWD|_KEY|APIKEY)[\w.-]*["']?[ \t]*[=:][ \t]*)("[^"\n]*"|'[^'\n]*'|[^\s"',;]+)""",
    re.IGNORECASE,
)
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# 색 코드 밖의 이스케이프와 나머지 제어 문자. 줄바꿈과 탭은 남긴다.
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
TIMESTAMP = re.compile(r"^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z ?", re.MULTILINE)
BINARY = re.compile(r"^(?:GIT binary patch|Binary files .* differ)$", re.MULTILINE)
# 리뷰·CI 설정과 의존성. 워크플로우 auto-merge job의 PROTECTED와 같은 패턴이고, 테스트가 둘이 같은지 본다.
PROTECTED = re.compile(
    r"^(\.github/|\.githooks/|\.claude/|\.codex/|scripts/|package\.json$|package-lock\.json$|\.npmrc$)|(^|/)CLAUDE(\.local)?\.md$"
)

ASK_DIR = WORKDIR / "ask"
ASK_TIMEOUT = 600
QUESTION_MAX = 2000
AUDIENCES = {"user": "사용자", "team": "운영진"}
VERDICTS = {"answer": "답변", "unknown": "확인 불가", "escalate": "escalation"}
# 프로젝트 안의 파일 읽기는 dontAsk에서 규칙 없이도 된다. 더 여는 것은 MCP 도구 둘뿐이고 그 호출은 ask_guard.py가 거른다.
ASK_ALLOWED = [ask_guard.SQL_TOOL, ask_guard.POSTHOG_TOOL]
# 읽기 전용 셸 명령도 규칙 없이 실행되고 Read 거부 규칙은 Bash의 cat을 막지 못한다. 그래서 Bash를 통째로 막는다.
ASK_DENIED = ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent",
              "Read(./.env*)", "Read(**/.env*)"]
ASK_SCHEMA = {
    "type": "object",
    "required": ["verdict", "draft", "evidence", "unverified"],
    "properties": {
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "draft": {"type": "string"},
        "evidence": {"type": "array", "items": {
            "type": "object",
            "required": ["claim", "kind", "ref"],
            "properties": {
                "claim": {"type": "string"},
                "kind": {"type": "string", "enum": ["code", "doc", "db", "log"]},
                "ref": {"type": "string"},
                "quote": {"type": "string"},
                "detail": {"type": "string"},
            },
        }},
        "unverified": {"type": "array", "items": {"type": "string"}},
        "escalation": {"type": "object", "properties": {
            "needed_change": {"type": "string"},
            "reason": {"type": "string"},
        }},
    },
}
# 계좌·카드·전화번호처럼 보이는 숫자열. 날짜와 시각이 걸리지 않게 붙임표로만 이어진 10자리 이상과 4자리 네 묶음만 본다.
# 경계는 \b가 아니라 숫자로 본다. 한글은 \w라서 "3456인데"의 숫자와 조사 사이에는 낱말 경계가 없다.
LONG_DIGITS = re.compile(r"\d(?:-?\d){9,}|(?<!\d)\d{4}(?: \d{4}){3}(?!\d)")
# 같은 이유로 ASCII 글자만 본다. \w로 쓰면 주소 뒤에 붙은 조사까지 가린다.
# 마지막 마디가 글자로 시작할 때만 이메일로 본다. next@16.0.3 같은 패키지 버전은 남긴다.
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z][A-Za-z0-9-]*")
FILE_REF = re.compile(r"(.+):(\d+)(?:-(\d+))?")
# 한두 글자짜리 인용은 어느 줄에나 있다.
QUOTE_MIN = 8
# 인용한 줄에서 이만큼 떨어진 줄까지 quote를 찾는다.
QUOTE_REACH = 2


class OncallError(Exception):
    """사람에게 보여 줄 사유가 담긴 오류."""


def redact(text: str) -> str:
    """시크릿처럼 보이는 문자열을 가린다. PR 본문과 job summary는 공개되므로 넓게 가린다."""
    text = TOKEN.sub(MASK, PEM.sub(MASK, text))
    text = URL_CREDENTIALS.sub(rf"\1:{MASK}@", BEARER.sub(rf"\1 {MASK}", text))
    return ASSIGNMENT.sub(rf"\1{MASK}", text)


def has_secret(text: str) -> bool:
    return bool(PEM.search(text) or TOKEN.search(text))


def clean_log(raw: str) -> str:
    """ANSI 코드, 제어 문자, 타임스탬프를 떼고 시크릿을 가린 뒤 끝부분만 남긴다."""
    # 색 코드가 토큰 중간에 끼어 있으면 패턴이 맞지 않으므로 먼저 뗀다.
    # 자른 뒤에 가리면 BEGIN 줄이 잘려 나간 개인키가 남으므로 가리기를 먼저 한다.
    text = redact(TIMESTAMP.sub("", CONTROL.sub("", ANSI.sub("", raw))))
    return "\n".join(text.splitlines()[-LOG_TAIL:]) + "\n"


def _is_bot(user: Optional[dict]) -> bool:
    user = user or {}
    return user.get("type") == "Bot" or str(user.get("login") or "").endswith("[bot]")


def failed_step(jobs: List[dict]) -> Tuple[Optional[dict], Optional[str]]:
    """(실패한 CI job, 그 job에서 실패한 단계 이름). 실패한 CI job이 없으면 (None, None)이다."""
    for job in jobs:
        if job.get("name") in CI_JOBS and job.get("conclusion") == "failure":
            names = [s.get("name") for s in job.get("steps") or [] if s.get("conclusion") == "failure"]
            return job, names[0] if names else None
    return None, None


def skip_reason(run: dict, jobs: List[dict], open_prs: List[dict]) -> Optional[str]:
    """on-call이 깨어나면 안 되는 실패면 사유를, 고쳐 볼 실패면 None을 돌려준다."""
    if (run.get("head_branch") or "").startswith(BRANCH_PREFIX):
        return "on-call이 만든 브랜치의 실패"
    if _is_bot(run.get("actor")) or _is_bot(run.get("triggering_actor")):
        return "봇이 일으킨 실행"
    commit = run.get("head_commit") or {}
    if (commit.get("author") or {}).get("name") == BOT_NAME or ONCALL_COMMIT.search(commit.get("message") or ""):
        return "on-call 수정 직후의 실패"
    if (run.get("head_repository") or {}).get("full_name") != (run.get("repository") or {}).get("full_name"):
        return "포크에서 온 실행"
    job, step = failed_step(jobs)
    if job is None:
        return f"실패한 CI job({', '.join(CI_JOBS)}) 없음"
    if step not in STEPS:
        return f"lint·build·test가 아닌 단계의 실패: {step}"
    # 재실행이나 연속 push로 같은 브랜치에 수정 PR이 쌓이지 않게 한다.
    if any(((pr.get("head") or {}).get("ref") or "").startswith(BRANCH_PREFIX) for pr in open_prs):
        return "이 브랜치에 열려 있는 on-call PR이 있음"
    return None


def patch_problem(patch: str) -> Optional[str]:
    """PR로 열면 안 되는 패치면 사유를 돌려준다. 걸린 문자열은 사유에 넣지 않는다."""
    if BINARY.search(patch):
        return "패치에 바이너리 변경이 있습니다."
    added = "\n".join(line for line in patch.splitlines() if line.startswith("+"))
    if has_secret(added):
        return "패치의 추가된 줄에 시크릿처럼 보이는 문자열이 있습니다."
    return None


def _run(cmd: List[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise OncallError(f"{' '.join(cmd[:3])} 실패: {redact(r.stderr.strip())}")
    return r.stdout


def _job_log(job_id: int) -> str:
    """job 하나의 원본 로그. 다른 job의 로그는 받지 않는다."""
    path = f"{API}/actions/jobs/{job_id}/logs"
    # 로그에는 색 코드가 있어서 새 gh는 이 옵션 없이는 응답을 출력하지 않는다. 옛 gh에는 이 옵션이 없다.
    try:
        return _run(["gh", "api", "--allow-escape-sequences", path])
    except OncallError as e:
        if "unknown flag" not in str(e):
            raise
        return _run(["gh", "api", path])


def _check_checkout(sha: str) -> None:
    """작업 트리가 깨끗하고 HEAD가 실패한 커밋인지 확인한다. 아니면 수정이 다른 커밋 위에 얹힌다."""
    if _run(["git", "status", "--porcelain"]).strip():
        raise OncallError("작업 트리에 커밋하지 않은 변경이 있습니다.")
    if _run(["git", "rev-parse", "HEAD"]).strip() != sha:
        raise OncallError(f"HEAD가 실패한 커밋({sha[:7]})이 아닙니다.")


def _write_output(path: Optional[str], **values: str) -> None:
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.writelines(f"{key}={value}\n" for key, value in values.items())


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""


def cmd_prepare(args: argparse.Namespace) -> int:
    run = json.loads(_run(["gh", "api", f"{API}/actions/runs/{args.run_id}"]))
    jobs = json.loads(_run(["gh", "api", f"{API}/actions/runs/{args.run_id}/jobs?per_page=100"]))["jobs"]
    base = quote(run.get("head_branch") or "", safe="")
    open_prs = json.loads(_run(["gh", "api", f"{API}/pulls?state=open&base={base}&per_page=100"]))

    reason = skip_reason(run, jobs, open_prs)
    if reason:
        _write_output(args.output, ready="false")
        print(f"on-call: 건너뜁니다 ({reason}).")
        return 0

    _check_checkout(run["head_sha"])
    job, step = failed_step(jobs)
    # 실패한 CI job의 로그만 받는다. 다른 job의 로그는 에이전트에게 주지 않는다.
    log = clean_log(_job_log(job["id"]))
    WORKDIR.mkdir(exist_ok=True)
    (WORKDIR / "failed.log").write_text(log, encoding="utf-8")
    _write_output(args.output, ready="true", step=STEPS[step])
    print(f"on-call: {STEPS[step]} 단계의 실패 로그를 {WORKDIR / 'failed.log'}에 준비했습니다.")
    return 0


def _footer(run_url: str, pr: Optional[int], protected: bool) -> str:
    lines = ["---", "on-call 에이전트가 CI 실패를 보고 만든 수정입니다.", "", f"- 실패한 실행: {run_url}"]
    if pr:
        lines.append(f"- 원래 PR: #{pr}")
    lines += [
        "- 검증: on-call job 안에서 lint·build·test를 통과한 패치입니다.",
        # 승인하면 PR 쪽 스크립트가 시크릿과 함께 실행되므로 확인을 먼저 안내한다.
        "- 이 PR의 CI와 리뷰는 승인 대기 상태로 멈춰 있습니다. 변경 내용을 확인한 뒤 이 PR에서 워크플로우 실행을 승인하면 돕니다.",
    ]
    if protected:
        lines.append(
            "- ⚠️ 이 패치는 리뷰·CI 설정이나 의존성을 고칩니다. 워크플로우를 승인하면 고친 판이 시크릿과 함께 실행됩니다. "
            "변경을 확인하기 전에는 승인하지 마세요."
        )
    lines += [
        "- **자동 머지되지 않습니다.** 테스트가 약해지지 않았는지 확인하고 직접 머지하세요.",
        "",
        "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    ]
    return "\n".join(lines) + "\n"


def cmd_publish(args: argparse.Namespace) -> int:
    folder = Path(args.folder)
    report = redact(_read(folder / "report.md")).strip() or "on-call 에이전트가 보고서를 남기지 않았습니다."
    print(report)

    patch = _read(folder / "fix.patch")
    if not patch.strip():
        print("\n**on-call: 검증을 통과한 수정이 없습니다. PR을 열지 않습니다.**")
        return 0
    problem = patch_problem(patch)
    if problem:
        print(f"\n**on-call: {problem} PR을 열지 않습니다.**")
        return 1

    # 브랜치, 제목, 커밋 메시지는 호출자가 넘긴 값으로만 만든다. 에이전트가 쓴 글은 가린 본문에만 들어간다.
    branch = f"{BRANCH_PREFIX}ci-fix-{args.run_id}-{args.attempt}"
    title = f"fix(oncall): CI 실패 수정 — {args.step} ({args.sha[:7]})"
    run_url = f"https://github.com/{args.repo}/actions/runs/{args.run_id}"
    try:
        _check_checkout(args.sha)
        _run(["git", "switch", "-c", branch])
        _run(["git", "apply", "--index", str(folder / "fix.patch")])
        # 바뀐 경로는 패치의 글자가 아니라 적용된 결과에서 읽는다. git apply는 따옴표로 감싼 경로와 diff --git 줄이 없는
        # 패치도 받으므로 글자를 해석하면 빠지는 경우가 생긴다. --no-renames는 옮긴 파일의 옛 경로와 새 경로를 모두 준다.
        changed = _run(["git", "diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD"]).split("\0")
        protected = any(PROTECTED.search(path) for path in changed)
        _run(["git", "-c", f"user.name={BOT_NAME}", "-c", f"user.email={BOT_EMAIL}",
              "commit", "-q", "-m", title, "-m", f"{TRAILER}: {run_url}"])
        _run(["git", "push", "origin", branch])
    except OncallError as e:
        print(f"ON-CALL: {e}", file=sys.stderr)
        print("\n**on-call: 수정 브랜치를 올리지 못했습니다. PR을 열지 않습니다.**")
        return 1

    body_file = folder / "body.md"
    body_file.write_text(f"{report}\n\n{_footer(run_url, args.pr, protected)}", encoding="utf-8")
    try:
        url = _run(["gh", "pr", "create", "--base", args.base, "--head", branch,
                    "--title", title, "--body-file", str(body_file)]).strip()
    except OncallError as e:
        print(f"ON-CALL: {e}", file=sys.stderr)
        # PR 없는 브랜치를 남기지 않는다.
        subprocess.run(["git", "push", "origin", "--delete", branch], capture_output=True, text=True)
        print("\n**on-call: PR을 열지 못했습니다. 올린 브랜치는 지웠습니다.**")
        return 1
    print(f"\n**on-call: 수정 PR을 열었습니다 — {url} 자동 머지되지 않으니 직접 리뷰하고 머지하세요.**")
    return 0


def clean_question(text: str) -> str:
    """질문에서 제어 문자를 떼고 시크릿, 긴 숫자열, 이메일을 가린다. 계좌·카드번호와 이메일은 LLM에 보내지 않는다.

    이름은 가려내지 못한다.
    """
    text = redact(CONTROL.sub("", ANSI.sub("", text)))
    return LONG_DIGITS.sub(MASK, EMAIL.sub(MASK, text)).strip()[:QUESTION_MAX]


def run_ask(user_id: Optional[str], timeout: int) -> dict:
    """claude로 /oncall ask를 돌려 구조화된 답을 돌려준다. 질문은 명령줄이 아니라 question.json으로 넘긴다."""
    # CLAUDECODE가 남아 있으면 Claude Code 세션 안에서 실행할 때 중첩 실행이 거부된다.
    # 바깥 환경에 남아 있던 user id로 다른 계정이 조회되지 않게 그 값도 뺀다.
    env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "ONCALL_ASK_USER_ID")}
    # 이 값이 ask_guard.py를 켜고 Stop 훅의 lint·build·test를 건너뛰게 한다.
    env["ONCALL_ASK_ACTIVE"] = "1"
    if user_id:
        env["ONCALL_ASK_USER_ID"] = user_id
    try:
        r = subprocess.run(
            ["claude", "-p", "/oncall ask", "--output-format", "json", "--json-schema", json.dumps(ASK_SCHEMA),
             "--permission-mode", "dontAsk", "--allowedTools", *ASK_ALLOWED, "--disallowedTools", *ASK_DENIED],
            capture_output=True, text=True, env=env, timeout=timeout,
            stdin=subprocess.DEVNULL,
        )
    except OSError as e:
        raise OncallError(f"claude 명령을 실행할 수 없습니다: {e}")
    except subprocess.TimeoutExpired:
        raise OncallError(f"{timeout}초 제한 시간을 초과했습니다.")

    try:
        output = json.loads(r.stdout)
    except json.JSONDecodeError:
        output = None
    if not isinstance(output, dict) or r.returncode != 0 or output.get("is_error"):
        raise OncallError(f"claude 실행에 실패했습니다 (code {r.returncode}).")
    answer = output.get("structured_output")
    if not isinstance(answer, dict):
        # 구조화된 답이 따로 오지 않으면 마지막 메시지를 JSON으로 읽는다.
        try:
            answer = json.loads(output.get("result") or "")
        except ValueError:
            answer = None
    if not isinstance(answer, dict):
        raise OncallError("에이전트의 답을 읽을 수 없습니다.")
    return answer


def _spaces(text: str) -> str:
    return " ".join(text.split())


def _quoted(text: str) -> List[str]:
    """사람이나 모델이 쓴 여러 줄 글을 인용 블록으로 싣는다. 줄바꿈으로 answer.md의 절을 흉내 내지 못하게 한다."""
    return [f"> {line}" if line.strip() else ">" for line in text.strip().splitlines()]


def _file_evidence(kind: str, ref: str, quoted: object, tracked: Set[str]) -> Tuple[Optional[str], str]:
    """(문제, 파일에서 읽은 줄). 인용한 줄이 저장소가 추적하는 파일에 있고 quote가 그 근처에 있어야 한다."""
    m = FILE_REF.fullmatch(ref)
    if not m:
        return "`경로:줄` 모양이 아닙니다", ""
    path, start, end = Path(m.group(1)), int(m.group(2)), int(m.group(3) or m.group(2))
    # 대소문자를 가리지 않는 파일 시스템에서는 .ENV.local이 .env.local을 연다.
    if path.is_absolute() or ".." in path.parts or any(part.lower().startswith(".env") for part in path.parts):
        return "저장소 밖이거나 인용할 수 없는 경로입니다", ""
    # .git, 빌드 산출물, 로컬 설정처럼 추적되지 않는 파일은 근거가 아니다.
    if path.as_posix() not in tracked or not path.is_file() or not path.resolve().is_relative_to(Path.cwd().resolve()):
        return "저장소가 추적하는 파일이 아닙니다", ""
    expected = "doc" if path.parts[0] == "docs" or path.suffix == ".md" else "code"
    if kind != expected:
        return f"이 파일의 kind는 {expected}여야 합니다", ""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    if not 1 <= start <= end <= len(lines):
        return "그 줄이 파일에 없습니다", ""
    needle = _spaces(quoted) if isinstance(quoted, str) else ""
    if len(needle) < QUOTE_MIN:
        return "quote가 없거나 너무 짧습니다", ""
    if needle not in _spaces(" ".join(lines[max(start - 1 - QUOTE_REACH, 0):end + QUOTE_REACH])):
        return "quote가 인용한 줄 근처에 없습니다", ""
    return None, " ".join(line.strip() for line in lines[start - 1:end])


def _evidence(item: object, ledger: List[str], tracked: Set[str]) -> Tuple[Optional[str], str]:
    """(문제, 호출자가 확인한 내용). 파일 인용은 파일과, 조회는 ask_guard.py가 남긴 기록과 대조한다."""
    if not isinstance(item, dict):
        return "근거 항목이 객체가 아닙니다", ""
    kind, ref, claim = item.get("kind"), item.get("ref"), item.get("claim")
    if not isinstance(ref, str) or not isinstance(claim, str) or not claim.strip():
        return "claim이나 ref가 없습니다", ""
    if not isinstance(item.get("detail", ""), str):
        return "detail이 글이 아닙니다", ""
    if kind in ("code", "doc"):
        return _file_evidence(kind, ref, item.get("quote"), tracked)
    if kind == "db":
        allowed = ref in ask_guard.SQL_TEMPLATES and f"allow\t{ask_guard.SQL_TOOL}\t{ref}" in ledger
    elif kind == "log":
        # 스키마만 본 것(info, schema)은 조회가 아니다.
        allowed = ref in ask_guard.POSTHOG_TOOLS and f"allow\t{ask_guard.POSTHOG_TOOL}\tcall {ref}" in ledger
    else:
        return "kind가 code, doc, db, log 중 하나가 아닙니다", ""
    # 기록은 호출 전에 남는다. 허용됐다는 것까지만 알 수 있고 성공했는지는 알 수 없다.
    return (None, "이 세션에서 허용된 조회") if allowed else ("이 세션에서 허용된 조회 기록이 없습니다", "")


def check_answer(answer: dict, audience: str, ledger: List[str], tracked: Set[str]) -> Tuple[List[str], List[str]]:
    """(문제 목록, 근거마다 호출자가 확인한 내용). 문제가 하나라도 있으면 답을 초안으로 내지 않는다."""
    problems, confirmed = [], []
    # 훅이 로드되지 않은 세션은 MCP로 무엇을 조회했는지 알 수 없다. 조회 근거가 없는 답이어도 버린다.
    if ask_guard.ARMED not in ledger:
        problems.append("가드가 켜진 기록이 없는 세션입니다. `.claude/settings.json`의 훅이 로드됐는지 확인하세요.")
    verdict = answer.get("verdict")
    if not isinstance(verdict, str) or verdict not in VERDICTS:
        problems.append(f"verdict가 {', '.join(VERDICTS)} 중 하나가 아닙니다.")
    if not isinstance(answer.get("draft"), str) or not answer["draft"].strip():
        problems.append("초안이 비어 있습니다.")
    evidence = answer.get("evidence")
    if not isinstance(evidence, list):
        problems.append("evidence가 목록이 아닙니다.")
        evidence = []
    for item in evidence:
        problem, seen = _evidence(item, ledger, tracked)
        if problem:
            ref = item.get("ref") if isinstance(item, dict) else item
            problems.append(f"근거 `{ref}`: {problem}.")
        confirmed.append(seen)
    if verdict == "answer":
        if not evidence:
            problems.append("answer인데 근거가 없습니다.")
        # 문서는 계획이다. 사용자에게 동작을 말하려면 코드나 조회로 확인한 근거가 있어야 한다.
        elif audience == "user" and all(isinstance(item, dict) and item.get("kind") == "doc" for item in evidence):
            problems.append("사용자에게 가는 답의 근거가 문서뿐입니다.")
    unverified = answer.get("unverified", [])
    if not isinstance(unverified, list) or not all(isinstance(entry, str) for entry in unverified):
        problems.append("unverified가 글의 목록이 아닙니다.")
    if verdict == "escalate":
        escalation = answer.get("escalation")
        change = escalation.get("needed_change") if isinstance(escalation, dict) else None
        if not isinstance(change, str) or not change.strip() or not isinstance(escalation.get("reason", ""), str):
            problems.append("escalate인데 escalation의 needed_change가 없거나 값이 글이 아닙니다.")
    return problems, confirmed


def render_answer(question: str, answer: dict, audience: str, user_id: Optional[str],
                  problems: List[str], confirmed: List[str]) -> str:
    """answer.md의 글. 검증에 실패한 답은 초안으로 싣지 않고 받은 그대로만 보여 준다."""
    head = ["", f"- 대상: {AUDIENCES[audience]}"]
    if problems:
        return "\n".join([
            "# on-call ask — 근거 검증 실패", *head,
            "- 상태: 근거 검증 실패 — 보내지 않습니다. 아래는 확인되지 않은 글입니다.",
            "", "## 검증 실패", *[f"- {problem}" for problem in problems],
            "", "## 질문", *_quoted(question),
            "", "## 에이전트가 낸 답", "```json", json.dumps(answer, ensure_ascii=False, indent=2), "```",
        ]) + "\n"

    lines = [f"# on-call ask — {VERDICTS[answer['verdict']]}", *head]
    if audience == "user":
        lines.append("- 상태: 승인 대기 — 사람이 승인하기 전에는 보내지 않습니다.")
        if user_id:
            # --user-id는 호출한 사람이 정한 값이다. 질문자가 그 계정의 주인이라는 증명이 아니다.
            lines.append("- 본인 확인: 지정한 계정의 정보로 쓴 초안입니다. 보내기 전에 질문자가 그 계정의 주인인지 확인하세요.")
    else:
        lines.append("- 상태: 내부 답변")
    lines += ["", "## 질문", *_quoted(question), "", "## 초안", *_quoted(answer["draft"]), "", "## 근거"]
    for number, (item, seen) in enumerate(zip(answer["evidence"], confirmed), 1):
        # 파일 근거에는 모델이 적은 인용이 아니라 호출자가 파일에서 읽은 줄을 싣는다.
        shown = f"파일의 줄: {seen}" if item["kind"] in ("code", "doc") else f"{seen}. {_spaces(item.get('detail') or '')}"
        lines += [f"{number}. {_spaces(item['claim'])}", f"   - {item['kind']} `{item['ref']}` — {shown.strip()}"]
    if not answer["evidence"]:
        lines.append("없음")
    # 모델이 쓴 한 줄짜리 값은 줄바꿈을 접어 싣는다.
    unverified = [_spaces(entry) for entry in answer.get("unverified") or []]
    lines += ["", "## 확인하지 못한 것", *([f"- {entry}" for entry in unverified] or ["없음"])]
    escalation = answer.get("escalation")
    if answer["verdict"] == "escalate":
        lines += ["", "## escalation", f"- 필요한 변경: {_spaces(escalation['needed_change'])}",
                  f"- 사유: {_spaces(escalation.get('reason') or '') or '적지 않음'}"]
    return "\n".join(lines) + "\n"


def cmd_ask(args: argparse.Namespace) -> int:
    user_id = None
    if args.user_id:
        try:
            user_id = str(uuid.UUID(args.user_id))
        except ValueError:
            raise OncallError("--user-id가 uuid가 아닙니다.")
    question = clean_question(args.question)
    if not question:
        raise OncallError("질문이 비어 있습니다.")
    # 근거로 받는 것은 저장소가 추적하는 파일뿐이다.
    tracked = set(_run(["git", "ls-files", "-z"]).split("\0"))

    ASK_DIR.mkdir(parents=True, exist_ok=True)
    # 지난 실행의 답과 가드 기록이 이번 답의 근거로 읽히지 않게 지운다.
    for name in ("answer.md", "guard.log"):
        (ASK_DIR / name).unlink(missing_ok=True)
    question_file = ASK_DIR / "question.json"
    question_file.write_text(
        json.dumps({"audience": args.audience, "user_id": user_id, "question": question}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("ON-CALL: /oncall ask 실행 중입니다. 몇 분 걸립니다.", file=sys.stderr)
    try:
        answer = run_ask(user_id, args.timeout)
    finally:
        # 호출자 없이 스킬을 직접 부르면 가드가 꺼져 있다. 입력을 남기지 않아야 스킬이 거기서 멈춘다.
        question_file.unlink(missing_ok=True)

    problems, confirmed = check_answer(answer, args.audience, _read(ASK_DIR / "guard.log").splitlines(), tracked)
    # 인용은 파일의 글과 대조하므로 가리기는 검사 뒤에 한다.
    text = render_answer(question, answer, args.audience, user_id, problems, confirmed)
    # 모델이 쓴 값의 백스페이스와 ESC가 터미널에서 인용 표시나 상태 줄을 덮어쓰지 못하게 뗀다.
    text = redact(CONTROL.sub("", ANSI.sub("", text)))
    (ASK_DIR / "answer.md").write_text(text, encoding="utf-8")
    print(text, end="")
    if problems:
        print("ON-CALL: 근거를 확인하지 못한 답입니다. 초안으로 쓰지 않습니다.", file=sys.stderr)
    return 1 if problems else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="On-call")
    commands = parser.add_subparsers(dest="command", required=True)

    prepare = commands.add_parser("prepare", help="가드를 확인하고 실패한 CI job의 로그를 준비한다")
    prepare.add_argument("run_id", type=int, help="실패한 워크플로우 run의 id")
    prepare.add_argument("--output", metavar="파일", help="이 파일에 ready=<true|false>와 step=<단계>를 덧붙인다")
    prepare.set_defaults(func=cmd_prepare)

    publish = commands.add_parser("publish", help="넘겨받은 보고와 패치로 수정 브랜치와 PR을 만든다")
    publish.add_argument("folder", help="report.md와 fix.patch가 든 폴더")
    publish.add_argument("--base", required=True, help="PR의 base가 될, CI가 실패한 브랜치")
    publish.add_argument("--sha", required=True, help="CI가 실패한 커밋")
    publish.add_argument("--run-id", type=int, required=True)
    publish.add_argument("--attempt", type=int, default=1)
    publish.add_argument("--repo", required=True, help="owner/name")
    publish.add_argument("--step", required=True, choices=sorted(STEPS.values()))
    publish.add_argument("--pr", type=int, help="CI가 실패한 PR의 번호")
    publish.set_defaults(func=cmd_publish)

    ask = commands.add_parser("ask", help="질문 하나에 근거로 답한 초안을 .oncall/ask/answer.md에 남긴다")
    ask.add_argument("question", help="질문 글")
    ask.add_argument("--audience", required=True, choices=sorted(AUDIENCES), help="user는 FinSight 사용자, team은 운영진")
    ask.add_argument("--user-id", metavar="uuid", help="질문이 가리키는 계정. 줄 때만 그 계정의 집계를 조회한다")
    ask.add_argument("--timeout", type=int, default=ASK_TIMEOUT, help="claude 실행 제한 시간(초)")
    ask.set_defaults(func=cmd_ask)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except OncallError as e:
        print(f"ON-CALL: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
