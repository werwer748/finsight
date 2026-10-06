#!/usr/bin/env python3
"""
Bash Guard — 되돌리기 어려운 명령어 패턴이 담긴 Bash 호출을 막는 PreToolUse 훅.

stdin으로 훅 입력(JSON)을 받아, 차단해야 하면 stderr에 사유를 쓰고 exit 2 한다.
명령어 문자열을 정규식으로 훑을 뿐 셸 문법을 해석하지는 않는다.
"""

import json
import re
import sys
from typing import Optional

DANGEROUS = re.compile(r"rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|DROP\s+TABLE")


def check(command: str) -> Optional[str]:
    """차단해야 하면 사유 메시지를, 통과면 None을 돌려준다."""
    if DANGEROUS.search(command):
        return "BLOCKED: 위험한 명령어가 감지되었습니다."
    return None


def main():
    payload = json.load(sys.stdin)
    command = payload.get("tool_input", {}).get("command")
    if not command:
        return

    message = check(command)
    if message:
        print(message, file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
