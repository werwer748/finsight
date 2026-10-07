#!/usr/bin/env python3
"""
Review Gate — /review-code 스킬을 헤드리스로 돌리고 판정에 따라 커밋·PR을 막는다.

pre-commit 훅(.githooks/pre-commit)과 GitHub Action(.github/workflows/review-code.yml)이 같이 쓴다.
stdout에는 리뷰 보고만, stderr에는 안내만 쓴다. 통과·건너뜀은 exit 0, 차단은 exit 1.

Usage:
    python3 scripts/review_gate.py (--staged | --base <ref>) [--fail-on danger|warning] [--strict] [--timeout <초>]
"""

import argparse
import json
import os
import re
import subprocess
import sys
from typing import List, Optional, Tuple

VERDICT = re.compile(r"^## 리뷰 결과: (🔴|🟠|🟡|🟢)(.*)$", re.MULTILINE)
NO_CHANGES = "리뷰할 변경이 없습니다."
NOT_RUN = "## 리뷰 결과: ⚫ 리뷰를 실행하지 못했습니다"
BLOCKING = {"danger": ("🔴",), "warning": ("🔴", "🟠")}
DOC_DIRS = ("docs/", "phases/")
CLAUDE_TIMEOUT = 1500
# git diff·log·show, grep, rg, find, ls 같은 읽기 전용 명령은 규칙 없이도 dontAsk에서 실행된다.
# Bash 규칙을 넓게 주면 git push나 find -delete까지 열리므로 merge-base 하나만 더한다.
ALLOWED_TOOLS = ["Read", "Agent", "Bash(git merge-base *)"]


def parse_report(report: str) -> Tuple[Optional[str], bool]:
    """(판정 단계, 리뷰에 실패한 차원이 있는가). 판정 줄을 읽을 수 없으면 단계는 None이다."""
    m = VERDICT.search(report)
    if m:
        return m.group(1), "리뷰 실패" in m.group(2)
    if NO_CHANGES in report:
        return "🟢", False
    return None, False


def exit_code(stage: Optional[str], failed: bool, *, fail_on: str, strict: bool) -> int:
    if stage in BLOCKING[fail_on]:
        return 1
    if stage is None or failed:
        return 1 if strict else 0
    return 0


def _is_doc(path: str) -> bool:
    return path.endswith(".md") or path.startswith(DOC_DIRS)


def skip_reason(staged: bool) -> Optional[str]:
    """리뷰를 건너뛰어야 하면 사유를, 돌려야 하면 None을 돌려준다."""
    if os.environ.get("SKIP_REVIEW") == "1":
        return "SKIP_REVIEW=1"
    if os.environ.get("REVIEW_GATE_ACTIVE"):
        return "리뷰 세션 안에서 다시 호출됨"
    if staged:
        # -z가 없으면 한글이나 공백이 든 경로가 따옴표와 이스케이프로 나온다.
        r = subprocess.run(["git", "diff", "--cached", "--name-only", "-z"], capture_output=True, text=True)
        files = [f for f in r.stdout.split("\0") if f]
        if not files:
            return "staged 변경 없음"
        if all(_is_doc(f) for f in files):
            return "문서만 변경됨"
    return None


def run_review(target: str, timeout: int) -> str:
    """claude로 /review-code를 돌려 보고를 돌려준다. 돌리지 못하면 ⚫ 판정 줄과 사유를 돌려준다."""
    # CLAUDECODE가 남아 있으면 Claude Code 세션 안에서 커밋할 때 중첩 실행이 거부된다.
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    env["REVIEW_GATE_ACTIVE"] = "1"
    try:
        r = subprocess.run(
            ["claude", "-p", f"/review-code {target}", "--output-format", "json",
             "--permission-mode", "dontAsk", "--allowedTools", *ALLOWED_TOOLS],
            capture_output=True, text=True, env=env, timeout=timeout,
            stdin=subprocess.DEVNULL,
        )
    except OSError as e:
        return f"{NOT_RUN}\n\nclaude 명령을 실행할 수 없습니다: {e}"
    except subprocess.TimeoutExpired:
        return f"{NOT_RUN}\n\n{timeout}초 제한 시간을 초과했습니다."

    try:
        output = json.loads(r.stdout)
    except json.JSONDecodeError:
        output = None
    if not isinstance(output, dict):
        return f"{NOT_RUN}\n\nclaude 출력을 읽을 수 없습니다 (code {r.returncode})."
    result = output.get("result") or ""
    if r.returncode != 0 or output.get("is_error"):
        return f"{NOT_RUN}\n\n{result}"
    return result


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Review Gate")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--staged", action="store_true", help="staged 변경만 리뷰한다")
    target.add_argument("--base", help="이 브랜치·커밋과의 merge-base 이후를 리뷰한다")
    parser.add_argument("--fail-on", choices=list(BLOCKING), default="danger",
                        help="danger는 🔴에서, warning은 🔴·🟠에서 막는다")
    parser.add_argument("--strict", action="store_true", help="리뷰를 끝내지 못한 경우도 막는다")
    parser.add_argument("--timeout", type=int, default=CLAUDE_TIMEOUT, help="claude 실행 제한 시간(초)")
    args = parser.parse_args(argv)

    reason = skip_reason(args.staged)
    if reason:
        print(f"REVIEW GATE: 리뷰를 건너뜁니다 ({reason}).", file=sys.stderr)
        return 0

    print("REVIEW GATE: /review-code 실행 중입니다. 몇 분 걸립니다.", file=sys.stderr)
    report = run_review("--staged" if args.staged else args.base, args.timeout)
    print(report)

    stage, failed = parse_report(report)
    code = exit_code(stage, failed, fail_on=args.fail_on, strict=args.strict)
    if code:
        print("REVIEW GATE: 차단합니다. 위 보고를 확인하고 고친 뒤 다시 시도하세요.", file=sys.stderr)
    elif stage is None or failed:
        print("REVIEW GATE: 리뷰를 끝내지 못했습니다. 막지 않고 통과시킵니다.", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
