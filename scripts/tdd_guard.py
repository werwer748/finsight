#!/usr/bin/env python3
"""
TDD Guard — 구현 파일을 고치기 전에 대응 테스트가 먼저 변경되었는지 확인하는 PreToolUse 훅.

stdin으로 훅 입력(JSON)을 받아, 차단해야 하면 stderr에 사유를 쓰고 exit 2 한다.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

GUARDED_DIRS = ("src/lib/", "src/services/", "src/app/api/", "src/components/")
CODE_EXTS = (".ts", ".tsx")
TEST_EXTS = (".test.ts", ".test.tsx")
PATCH_FILE = re.compile(r"^\*\*\* (?:Add|Update) File: (.+)$", re.MULTILINE)


def _changed_since_commit(path: Path, root: Path) -> bool:
    r = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all", "--", str(path)],
        cwd=root, capture_output=True, text=True,
    )
    # git repo가 아니면 순서를 판단할 수 없으므로 존재 여부만으로 통과시킨다.
    return r.returncode != 0 or bool(r.stdout.strip())


def check(file_path: str, root: Path) -> Optional[str]:
    """차단해야 하면 사유 메시지를, 통과면 None을 돌려준다."""
    root = root.resolve()
    path = Path(file_path).resolve()
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        return None

    if not rel.startswith(GUARDED_DIRS):
        return None
    if not rel.endswith(CODE_EXTS) or rel.endswith(".d.ts") or rel.endswith(TEST_EXTS):
        return None

    base = path.with_suffix("")
    tests = [t for t in (Path(f"{base}{ext}") for ext in TEST_EXTS) if t.exists()]

    if not tests:
        expected = Path(f"{base}.test{path.suffix}").relative_to(root).as_posix()
        return f"TDD GUARD: {rel} 의 테스트가 없습니다. 먼저 {expected} 를 작성한 뒤 다시 시도하세요."

    if not any(_changed_since_commit(t, root) for t in tests):
        test_rel = tests[0].relative_to(root).as_posix()
        return (
            f"TDD GUARD: {test_rel} 가 마지막 커밋 이후 변경되지 않았습니다. "
            f"{rel} 을(를) 고치기 전에 테스트를 먼저 추가·수정하세요."
        )

    return None


def target_paths(payload: dict) -> List[str]:
    """고치려는 파일 경로들. Claude Code의 Write·Edit은 file_path를, Codex의 apply_patch는 패치 본문을 준다."""
    tool_input = payload.get("tool_input", {})
    if tool_input.get("file_path"):
        return [tool_input["file_path"]]
    cwd = payload.get("cwd", "")
    return [os.path.join(cwd, p.strip()) for p in PATCH_FILE.findall(tool_input.get("command") or "")]


def main():
    payload = json.load(sys.stdin)
    paths = target_paths(payload)
    if not paths:
        return

    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload["cwd"])
    for file_path in paths:
        message = check(file_path, root)
        if message:
            print(message, file=sys.stderr)
            sys.exit(2)


if __name__ == "__main__":
    main()
