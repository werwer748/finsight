#!/usr/bin/env python3
"""
On-call — CI 실패를 고치는 /oncall 스킬의 앞뒤 단계.

prepare는 에이전트를 띄우기 전에 실행한다. 깨어나도 되는 실패인지 확인하고, 실패한 CI job의 로그만 받아
시크릿을 가린 뒤 .oncall/failed.log에 둔다.
publish는 에이전트가 끝난 뒤 새로 체크아웃한 곳에서 실행한다. 에이전트가 넘긴 보고와 패치를 데이터로만 다뤄
시크릿을 가리고 수정 브랜치와 PR을 만든다. 머지는 하지 않는다.

에이전트가 도는 job은 테스트를 실행하므로 임의 코드가 돌 수 있다. 그 job이 내놓은 것은 믿지 않고 publish에서 검사한다.
stdout에는 job summary로 나갈 글만, stderr에는 진단만 쓴다.

Usage:
    python3 scripts/oncall.py prepare <run-id> [--output <파일>]
    python3 scripts/oncall.py publish <폴더> --base <브랜치> --sha <커밋> --run-id <id> --repo <owner/name>
                                      --step lint|build|test [--attempt <N>] [--pr <번호>]
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import quote

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


def _footer(run_url: str, pr: Optional[int]) -> str:
    lines = ["---", "on-call 에이전트가 CI 실패를 보고 만든 수정입니다.", "", f"- 실패한 실행: {run_url}"]
    if pr:
        lines.append(f"- 원래 PR: #{pr}")
    lines += [
        "- 검증: on-call job 안에서 lint·build·test를 통과한 패치입니다. 이 PR에는 CI와 리뷰가 자동으로 돌지 않습니다.",
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
        _run(["git", "-c", f"user.name={BOT_NAME}", "-c", f"user.email={BOT_EMAIL}",
              "commit", "-q", "-m", title, "-m", f"{TRAILER}: {run_url}"])
        _run(["git", "push", "origin", branch])
    except OncallError as e:
        print(f"ON-CALL: {e}", file=sys.stderr)
        print("\n**on-call: 수정 브랜치를 올리지 못했습니다. PR을 열지 않습니다.**")
        return 1

    body_file = folder / "body.md"
    body_file.write_text(f"{report}\n\n{_footer(run_url, args.pr)}", encoding="utf-8")
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

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except OncallError as e:
        print(f"ON-CALL: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
