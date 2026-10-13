#!/usr/bin/env python3
"""
Ask Guard — /oncall ask 세션의 MCP 호출을 허용 목록으로 거르는 PreToolUse 훅.

ONCALL_ASK_ACTIVE가 없으면 아무것도 하지 않는다. 있으면 아래 목록에 든 호출만 통과시키고 나머지는 막는다.
stdin으로 훅 입력(JSON)을 받아, 차단해야 하면 stderr에 사유를 쓰고 exit 2 한다. 읽지 못한 입력도 막는다.
결정마다 .oncall/ask/guard.log에 한 줄을 남긴다. scripts/oncall.py ask가 그 기록으로 답의 근거를 대조한다.
기록은 호출 전에 쓴다. allow 줄은 호출을 허용했다는 뜻이고, 그 호출이 성공했다는 뜻은 아니다.
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Optional, Tuple

SQL_TOOL = "mcp__supabase__execute_sql"
POSTHOG_TOOL = "mcp__posthog__exec"
LOG = Path(".oncall") / "ask" / "guard.log"

# 이 MCP의 role은 RLS를 우회해 모든 사용자의 원본 행을 읽는다. 그래서 쿼리를 통째로 고정한다.
# 돌려주는 열은 건수, 날짜·시각의 최솟값·최댓값, 불리언뿐이다. 사용자가 쓴 글이 담긴 열은 돌려주지 않는다.
# .claude/skills/oncall/ask.md에 같은 글이 있고 테스트가 둘이 같은지 본다.
SQL_TEMPLATES = {
    "account": (
        "select count(*) as accounts, min(created_at) as signed_up_at, "
        "bool_or(email_confirmed_at is not null) as email_confirmed, max(last_sign_in_at) as last_sign_in_at "
        "from auth.users where id = '{user_id}'::uuid"
    ),
    "uploads": (
        "select count(*) as upload_attempts_total, "
        "count(*) filter (where created_at >= now() - interval '24 hours') as upload_attempts_last_24h, "
        "max(created_at) as last_attempt_at, "
        "min(created_at) filter (where created_at >= now() - interval '24 hours') as oldest_attempt_in_window_at "
        "from public.uploads where user_id = '{user_id}'::uuid"
    ),
    "transactions": (
        "select count(*) as transactions_total, min(date) as first_transaction_date, "
        "max(date) as last_transaction_date, max(created_at) as last_saved_at, "
        "count(*) filter (where created_at >= now() - interval '24 hours') as saved_last_24h "
        "from public.transactions where user_id = '{user_id}'::uuid"
    ),
}
# 사람 목록, 이메일, 스택과 변수 값을 돌려주는 도구(…-actors, …-issue-events, execute-sql)는 넣지 않는다.
# 도구마다 조회 조건으로 쓸 수 있는 키도 고정한다. 사람이나 세션으로 좁히는 키(user, personId, sessionId, assignee),
# 이메일까지 뒤지는 searchQuery, 속성 이름을 받는 filterGroup, 식을 받는 customColumns는 넣지 않는다.
POSTHOG_TOOLS = {
    "query-logs": frozenset({
        "serviceNames", "dateRange", "severityLevels", "searchTerm", "orderBy", "limit", "after", "excludeAttributes",
    }),
    "query-error-tracking-issues-list": frozenset({
        "dateRange", "status", "url", "filePath", "library", "release", "fingerprint",
        "orderBy", "orderDirection", "limit", "offset", "volumeResolution", "filterTestAccounts",
    }),
}
# query-logs는 조건을 모두 이 키 하나 안에 받는다.
LOGS_WRAPPER = "query"

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# ASCII 공백만 접는다. 다른 공백 문자가 든 쿼리는 템플릿과 달라져 막힌다.
SPACES = re.compile(r"[ \t\r\n]+")
LOOKUP = re.compile(r"(info) ([a-z0-9-]+)|(schema) ([a-z0-9-]+)(?: [A-Za-z0-9_.]+)?")
# --confirm이 어느 자리에 오든 도구 이름이나 JSON이 아니게 되어 걸러진다.
CALL = re.compile(r"call (?:--json )?([a-z0-9-]+) (.+)", re.DOTALL)

SQL_BLOCKED = (
    "ASK GUARD: 허용된 쿼리가 아닙니다. .claude/skills/oncall/ask.md의 SQL 템플릿을 글자 그대로 복사하고 "
    "{user_id} 자리에 question.json의 user_id만 넣으세요. 주석, 조건, 다른 문장을 덧붙일 수 없습니다."
)
NO_USER = "ASK GUARD: 이 질문에는 user_id가 없어 DB를 조회할 수 없습니다. 확인하지 못한 것으로 적으세요."
POSTHOG_BLOCKED = (
    "ASK GUARD: 허용된 PostHog 명령이 아닙니다. `info <tool>`, `schema <tool> [path]`, `call [--json] <tool> <json>`만 "
    f"쓸 수 있고 tool은 {', '.join(POSTHOG_TOOLS)}뿐입니다. learn, search, tools, execute-sql은 막혀 있습니다. "
    "조회 조건은 .claude/skills/oncall/ask.md에 적힌 키만 쓸 수 있습니다."
)
OTHER_BLOCKED = "ASK GUARD: /oncall ask 세션에서는 이 도구를 쓸 수 없습니다."
UNREADABLE = "ASK GUARD: 훅 입력을 읽거나 기록하지 못해 호출을 막았습니다."


def sql_template(query: object, user_id: str) -> Optional[str]:
    """호출자가 묶은 user_id를 넣은 템플릿과 같은 쿼리면 그 템플릿의 이름을, 아니면 None을 돌려준다."""
    if not isinstance(query, str) or not UUID.fullmatch(user_id):
        return None
    text = SPACES.sub(" ", query).strip(" ")
    if text.endswith(";"):
        text = text[:-1].rstrip(" ")
    for name, template in SQL_TEMPLATES.items():
        if text == template.replace("{user_id}", user_id):
            return name
    return None


def posthog_call(command: object) -> Optional[str]:
    """허용된 읽기 명령이면 "<동사> <도구>"를, 아니면 None을 돌려준다."""
    if not isinstance(command, str):
        return None
    command = command.strip()
    m = LOOKUP.fullmatch(command)
    if m:
        verb, tool = m.group(1) or m.group(3), m.group(2) or m.group(4)
        return f"{verb} {tool}" if tool in POSTHOG_TOOLS else None
    m = CALL.fullmatch(command)
    if not m or m.group(1) not in POSTHOG_TOOLS:
        return None
    tool = m.group(1)
    # 꼬리가 객체 하나가 아니면 막는다. 여러 줄에 쌓은 명령과 뒤에 붙인 옵션이 여기서 걸린다.
    try:
        body = json.loads(m.group(2))
    except ValueError:
        return None
    if tool == "query-logs":
        body = body.get(LOGS_WRAPPER) if isinstance(body, dict) and set(body) == {LOGS_WRAPPER} else None
    if not isinstance(body, dict) or not set(body) <= POSTHOG_TOOLS[tool]:
        return None
    return f"call {tool}"


def check(tool: str, tool_input: object, user_id: str) -> Tuple[Optional[str], str]:
    """(차단 사유, 기록에 남길 이름). 통과시킬 호출이면 사유가 None이다."""
    if not isinstance(tool_input, dict):
        tool_input = {}
    if tool == SQL_TOOL:
        name = sql_template(tool_input.get("query"), user_id)
        if name:
            return None, name
        return (SQL_BLOCKED if user_id else NO_USER), ""
    if tool == POSTHOG_TOOL:
        call = posthog_call(tool_input.get("command"))
        return (None, call) if call else (POSTHOG_BLOCKED, "")
    return OTHER_BLOCKED, ""


def main() -> int:
    # 이 값은 세션을 띄우는 쪽(scripts/oncall.py ask)이 세운다. 평소 세션의 MCP 호출은 건드리지 않는다.
    if not os.environ.get("ONCALL_ASK_ACTIVE"):
        return 0
    # 여기서부터는 예외로 끝나면 안 된다. 훅은 exit 2일 때만 호출을 막는다.
    try:
        payload = json.load(sys.stdin)
        tool = payload["tool_name"]
        if not isinstance(tool, str):
            raise TypeError("tool_name")
        message, detail = check(tool, payload.get("tool_input"), os.environ.get("ONCALL_ASK_USER_ID", ""))
        log = Path(os.environ.get("CLAUDE_PROJECT_DIR") or ".") / LOG
        log.parent.mkdir(parents=True, exist_ok=True)
        # 쿼리와 명령의 글은 남기지 않는다. 질문에서 온 글이 들어 있을 수 있다.
        with open(log, "a", encoding="utf-8") as f:
            f.write(f"{'block' if message else 'allow'}\t{tool}\t{detail}\n")
    except Exception:
        print(UNREADABLE, file=sys.stderr)
        return 2
    if message:
        print(message, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
