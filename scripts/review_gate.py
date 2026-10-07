#!/usr/bin/env python3
"""
Review Gate — /review-code 스킬을 헤드리스로 돌리고 판정에 따라 커밋·PR을 막는다.

pre-commit 훅(.githooks/pre-commit)과 GitHub Action(.github/workflows/review-code.yml)이 같이 쓴다.
stdout에는 리뷰 보고만, stderr에는 안내만 쓴다. 통과·건너뜀은 exit 0, 차단은 exit 1.
--decision-output을 주면 PR을 자동 머지할지(merge), 사람이 판단할지(hold), 닫을지(reject)도 정해
보고 끝에 한 줄로 붙이고 그 파일에 적는다.

Usage:
    python3 scripts/review_gate.py (--staged | --base <ref>) [--fail-on danger|warning] [--strict] [--timeout <초>]
                                   [--decision-output <파일>]
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
COUNTS = re.compile(r"^🔴 (\d+) · 🟠 (\d+) · 🟡 (\d+)", re.MULTILINE)
# 🔴가 이만큼이면 PR을 닫는다. 🔴·🟠 없이 🟡가 이만큼 이하면 자동 머지한다. 그 사이는 사람이 판단한다.
REJECT_MIN_DANGER = 2
AUTO_MERGE_MAX_CAUTION = 2
DECISION_NOTES = {
    "merge": "자동 머지 — lint·build·test가 통과하면 머지합니다. 리뷰·CI 설정이나 의존성을 고친 PR은 직접 머지합니다.",
    "hold": "직접 판단 — 자동으로 머지하지 않습니다.",
    "reject": f"거절 — 🔴 위험이 {REJECT_MIN_DANGER}건 이상이라 PR을 닫습니다. 고친 뒤 다시 열면 리뷰가 다시 돕니다.",
}
DOC_DIRS = ("docs/", "phases/")
CLAUDE_TIMEOUT = 1500
# 프로젝트 안의 파일 읽기와 읽기 전용 명령(git diff·log·show, grep, rg, find, ls)은 규칙 없이도 dontAsk에서 실행된다.
# Read나 Bash 규칙을 넓게 주면 프로젝트 밖 파일(/proc의 환경변수 등)과 git push까지 열리므로 더하지 않는다.
ALLOWED_TOOLS = ["Agent", "Bash(git merge-base *)"]
# 보고는 PR 댓글로 공개되므로 토큰처럼 보이는 문자열은 가린다.
SECRET = re.compile(r"sk-ant-[A-Za-z0-9_-]+")


def parse_report(report: str) -> Tuple[Optional[str], bool]:
    """(판정 단계, 리뷰에 실패한 차원이 있는가). 판정 줄을 읽을 수 없으면 단계는 None이다."""
    # 실패한 실행의 출력에 판정 줄이 섞여 있어도 판정으로 치지 않는다.
    if report.startswith(NOT_RUN):
        return None, False
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


def parse_counts(report: str) -> Optional[Tuple[int, int, int]]:
    """건수 줄의 (🔴, 🟠, 🟡) 발견 수. 건수 줄을 읽을 수 없으면 None이다."""
    m = COUNTS.search(report)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def decide(stage: Optional[str], failed: bool, counts: Optional[Tuple[int, int, int]]) -> str:
    """PR을 어떻게 할지 정한다. merge는 자동 머지, hold는 사람이 판단, reject는 PR 닫기."""
    if stage is None or counts is None:
        return "hold"
    danger, warning, caution = counts
    # 판정 줄과 건수 줄이 어긋난 보고로는 머지하지도 닫지도 않는다.
    if stage != ("🔴" if danger else "🟠" if warning else "🟡" if caution else "🟢"):
        return "hold"
    if danger >= REJECT_MIN_DANGER:
        return "reject"
    if failed or danger or warning or caution > AUTO_MERGE_MAX_CAUTION:
        return "hold"
    return "merge"


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
    parser.add_argument("--decision-output", metavar="파일",
                        help="머지 판정을 보고 끝에 붙이고 이 파일에 decision=<merge|hold|reject>로 덧붙인다")
    args = parser.parse_args(argv)

    reason = skip_reason(args.staged)
    if reason:
        print(f"REVIEW GATE: 리뷰를 건너뜁니다 ({reason}).", file=sys.stderr)
        return 0

    print("REVIEW GATE: /review-code 실행 중입니다. 몇 분 걸립니다.", file=sys.stderr)
    report = SECRET.sub("sk-ant-***", run_review("--staged" if args.staged else args.base, args.timeout))
    print(report)

    stage, failed = parse_report(report)
    if args.decision_output:
        decision = decide(stage, failed, parse_counts(report))
        print(f"\n**머지 판정: {DECISION_NOTES[decision]}**")
        with open(args.decision_output, "a", encoding="utf-8") as f:
            f.write(f"decision={decision}\n")
    code = exit_code(stage, failed, fail_on=args.fail_on, strict=args.strict)
    if code:
        print("REVIEW GATE: 차단합니다. 위 보고를 확인하고 고친 뒤 다시 시도하세요.", file=sys.stderr)
    elif stage is None or failed:
        print("REVIEW GATE: 리뷰를 끝내지 못했습니다. 막지 않고 통과시킵니다.", file=sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main())
