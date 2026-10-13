"""
ask_guard.py 테스트.
/oncall ask 세션의 MCP 호출 가운데 허용 목록에 든 것만 통과시키는 로직과 훅 입출력 규약을 검증한다.
쿼리와 명령은 문자열로만 넘기며 실제로 실행하지 않는다.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import ask_guard as guard

SCRIPT = Path(__file__).parent / "ask_guard.py"
PROJECT_ROOT = Path(__file__).parent.parent
SETTINGS = PROJECT_ROOT / ".claude" / "settings.json"
ASK_SKILL = PROJECT_ROOT / ".claude" / "skills" / "oncall" / "ask.md"

USER = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"
OTHER_USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
SQL = "mcp__supabase__execute_sql"
POSTHOG = "mcp__posthog__exec"
LOGS_BODY = '{"query": {"serviceNames": ["finsight"], "dateRange": {"date_from": "-24h"}}}'


def query(name, user_id=USER):
    return guard.SQL_TEMPLATES[name].replace("{user_id}", user_id)


# ---------------------------------------------------------------------------
# sql_template()
# ---------------------------------------------------------------------------

class TestSqlTemplate:
    @pytest.mark.parametrize("name", sorted(guard.SQL_TEMPLATES))
    def test_allows_template_with_bound_user(self, name):
        assert guard.sql_template(query(name), USER) == name

    @pytest.mark.parametrize("name", sorted(guard.SQL_TEMPLATES))
    def test_allows_whitespace_variants(self, name):
        assert guard.sql_template(query(name).replace(" ", "\n\t  "), USER) == name
        assert guard.sql_template(f"\n  {query(name)}  \n", USER) == name

    @pytest.mark.parametrize("tail", [";", " ;", ";\n"])
    def test_allows_one_trailing_semicolon(self, tail):
        assert guard.sql_template(query("uploads") + tail, USER) == "uploads"

    def test_blocks_other_user(self):
        assert guard.sql_template(query("uploads", OTHER_USER), USER) is None

    @pytest.mark.parametrize("user_id", ["", "not-a-uuid", USER.upper(), "x' or '1'='1"])
    def test_blocks_everything_without_valid_bound_user(self, user_id):
        # 묶인 값이 uuid가 아니면, 그 값을 넣어 만든 글과 같은 쿼리도 막는다.
        assert guard.sql_template(query("uploads", user_id), user_id) is None

    @pytest.mark.parametrize("suffix", [
        " -- 메모",
        " /* 메모 */",
        "; select * from public.transactions",
        " union all select 1, 2, now(), now()",
        " limit 1",
        " or true",
        ";;",
    ])
    def test_blocks_anything_appended(self, suffix):
        assert guard.sql_template(query("uploads") + suffix, USER) is None

    @pytest.mark.parametrize("sql", [
        "select * from public.transactions",
        f"select merchant, amount from public.transactions where user_id = '{USER}'::uuid",
        f"select email from auth.users where id = '{USER}'::uuid",
        "",
    ])
    def test_blocks_queries_outside_templates(self, sql):
        assert guard.sql_template(sql, USER) is None

    def test_blocks_changed_case(self):
        assert guard.sql_template(query("uploads").upper(), USER) is None

    def test_blocks_non_ascii_whitespace(self):
        assert guard.sql_template(query("uploads").replace(" ", " ", 1), USER) is None

    @pytest.mark.parametrize("value", [None, 123, ["select 1"], {"query": "select 1"}])
    def test_blocks_non_string(self, value):
        assert guard.sql_template(value, USER) is None

    def test_templates_return_no_text_columns(self):
        # 돌려주는 열은 건수, 날짜·시각의 최솟값·최댓값, 불리언뿐이다.
        for template in guard.SQL_TEMPLATES.values():
            columns = template[len("select "):template.index(" from ")]
            for column in re.split(r", (?=\w+\()", columns):
                assert re.match(r"(count|min|max|bool_or)\(", column), column
            assert not re.search(r"\b(merchant|amount|fingerprint|email|category)\b", columns)


# ---------------------------------------------------------------------------
# posthog_call()
# ---------------------------------------------------------------------------

class TestPosthogCall:
    @pytest.mark.parametrize("tool", guard.POSTHOG_TOOLS)
    def test_allows_read_forms(self, tool):
        assert guard.posthog_call(f"info {tool}") == f"info {tool}"
        assert guard.posthog_call(f"schema {tool}") == f"schema {tool}"
        assert guard.posthog_call(f"schema {tool} query.dateRange") == f"schema {tool}"
        assert guard.posthog_call(f"call {tool} {LOGS_BODY}") == f"call {tool}"
        assert guard.posthog_call(f"call --json {tool} {LOGS_BODY}") == f"call {tool}"

    def test_allows_multiline_json_body(self):
        body = json.dumps(json.loads(LOGS_BODY), indent=2)
        assert guard.posthog_call(f"call query-logs {body}") == "call query-logs"

    @pytest.mark.parametrize("command", [
        f"call --confirm query-logs {LOGS_BODY}",
        f"call --json --confirm query-logs {LOGS_BODY}",
        f"call --confirm --json query-logs {LOGS_BODY}",
        f"call query-logs --confirm {LOGS_BODY}",
        f"call query-logs {LOGS_BODY} --confirm",
    ])
    def test_blocks_confirm_in_any_position(self, command):
        assert guard.posthog_call(command) is None

    @pytest.mark.parametrize("command", [
        'call execute-sql {"query": "select * from persons"}',
        "call dashboard-create {}",
        "call query-error-tracking-issue-events {}",
        "call query-trends-actors {}",
        "call query-logs-extra {}",
        "info execute-sql",
        "schema dashboard-create",
        'learn -s "logs"',
        "learn project:anything",
        "tools",
        "search query-",
        "help",
        "",
    ])
    def test_blocks_tools_and_commands_outside_allowlist(self, command):
        assert guard.posthog_call(command) is None

    @pytest.mark.parametrize("command", [
        "call query-logs",
        "call query-logs not-json",
        "call query-logs [1, 2]",
        'call query-logs "text"',
        "call query-logs {} {}",
        "call query-logs {} trailing",
        "call query-logs {}\ncall dashboard-create {}",
        "info query-logs\ncall dashboard-create {}",
        "info query-logs extra",
    ])
    def test_blocks_malformed_or_stacked_commands(self, command):
        assert guard.posthog_call(command) is None

    @pytest.mark.parametrize("value", [None, 123, ["info query-logs"]])
    def test_blocks_non_string(self, value):
        assert guard.posthog_call(value) is None


# ---------------------------------------------------------------------------
# check()
# ---------------------------------------------------------------------------

class TestCheck:
    def test_allows_template_query(self):
        assert guard.check(SQL, {"query": query("account")}, USER) == (None, "account")

    def test_allows_posthog_read(self):
        assert guard.check(POSTHOG, {"command": f"call query-logs {LOGS_BODY}"}, USER) == (None, "call query-logs")

    def test_blocked_query_points_to_the_skill_templates(self):
        message, detail = guard.check(SQL, {"query": "select 1"}, USER)
        assert "ASK GUARD" in message and "ask.md" in message
        assert detail == ""

    def test_blocked_query_without_user_says_so(self):
        message, _ = guard.check(SQL, {"query": query("account")}, "")
        assert "user_id" in message

    def test_blocked_posthog_command_lists_the_allowed_forms(self):
        message, _ = guard.check(POSTHOG, {"command": "learn -s logs"}, USER)
        assert "ASK GUARD" in message
        for tool in guard.POSTHOG_TOOLS:
            assert tool in message

    @pytest.mark.parametrize("tool", [
        "mcp__supabase__list_tables",
        "mcp__supabase__apply_migration",
        "mcp__vercel__get_runtime_logs",
        "mcp__claude_ai_Notion__notion-search",
        "Bash",
    ])
    def test_blocks_every_other_tool(self, tool):
        message, _ = guard.check(tool, {"query": query("account"), "command": "info query-logs"}, USER)
        assert "ASK GUARD" in message

    @pytest.mark.parametrize("tool_input", [None, "select 1", [], 3])
    def test_blocks_tool_input_that_is_not_an_object(self, tool_input):
        message, _ = guard.check(SQL, tool_input, USER)
        assert "ASK GUARD" in message


# ---------------------------------------------------------------------------
# main() — 훅으로 실행될 때의 입출력
# ---------------------------------------------------------------------------

def hook_env(**extra):
    env = {k: v for k, v in os.environ.items() if k not in ("ONCALL_ASK_ACTIVE", "ONCALL_ASK_USER_ID")}
    env.update(extra)
    return env


def run_hook(stdin, tmp_path, **extra_env):
    if not isinstance(stdin, str):
        stdin = json.dumps(stdin)
    return subprocess.run(
        [sys.executable, str(SCRIPT)], input=stdin, capture_output=True, text=True,
        env=hook_env(CLAUDE_PROJECT_DIR=str(tmp_path), **extra_env),
    )


def run_active(stdin, tmp_path, user_id=USER):
    return run_hook(stdin, tmp_path, ONCALL_ASK_ACTIVE="1", ONCALL_ASK_USER_ID=user_id)


def ledger(tmp_path):
    path = tmp_path / ".oncall" / "ask" / "guard.log"
    return path.read_text(encoding="utf-8").splitlines() if path.is_file() else []


class TestMainOutsideAskSession:
    @pytest.mark.parametrize("stdin", [
        {"tool_name": SQL, "tool_input": {"query": "select * from public.transactions"}},
        {"tool_name": POSTHOG, "tool_input": {"command": "call dashboard-create {}"}},
        {"tool_name": "mcp__vercel__get_runtime_logs", "tool_input": {}},
        "not json",
    ])
    def test_does_nothing(self, stdin, tmp_path):
        r = run_hook(stdin, tmp_path)
        assert r.returncode == 0
        assert r.stderr == ""
        assert ledger(tmp_path) == []


class TestMainInAskSession:
    def test_template_query_exits_0_and_is_recorded(self, tmp_path):
        r = run_active({"tool_name": SQL, "tool_input": {"query": query("account")}}, tmp_path)
        assert r.returncode == 0
        assert r.stderr == ""
        assert ledger(tmp_path) == [f"allow\t{SQL}\taccount"]

    def test_posthog_read_exits_0_and_is_recorded(self, tmp_path):
        r = run_active({"tool_name": POSTHOG, "tool_input": {"command": f"call query-logs {LOGS_BODY}"}}, tmp_path)
        assert r.returncode == 0
        assert ledger(tmp_path) == [f"allow\t{POSTHOG}\tcall query-logs"]

    def test_other_query_exits_2_with_message(self, tmp_path):
        sql = f"select merchant, amount from public.transactions where user_id = '{USER}'::uuid"
        r = run_active({"tool_name": SQL, "tool_input": {"query": sql}}, tmp_path)
        assert r.returncode == 2
        assert "ASK GUARD" in r.stderr
        # 기록에는 쿼리 글을 남기지 않는다.
        assert ledger(tmp_path) == [f"block\t{SQL}\t"]

    def test_other_users_query_exits_2(self, tmp_path):
        r = run_active({"tool_name": SQL, "tool_input": {"query": query("uploads", OTHER_USER)}}, tmp_path)
        assert r.returncode == 2

    def test_template_query_exits_2_without_bound_user(self, tmp_path):
        payload = {"tool_name": SQL, "tool_input": {"query": query("account")}}
        assert run_hook(payload, tmp_path, ONCALL_ASK_ACTIVE="1").returncode == 2
        assert run_active(payload, tmp_path, user_id="").returncode == 2

    def test_posthog_write_exits_2(self, tmp_path):
        r = run_active({"tool_name": POSTHOG, "tool_input": {"command": "call dashboard-create {}"}}, tmp_path)
        assert r.returncode == 2
        assert ledger(tmp_path) == [f"block\t{POSTHOG}\t"]

    def test_other_mcp_tool_exits_2(self, tmp_path):
        r = run_active({"tool_name": "mcp__vercel__get_runtime_logs", "tool_input": {}}, tmp_path)
        assert r.returncode == 2
        assert ledger(tmp_path) == ["block\tmcp__vercel__get_runtime_logs\t"]

    @pytest.mark.parametrize("stdin", [
        "not json",
        "",
        "[]",
        {"tool_input": {"query": "select 1"}},
        {"tool_name": ["x"], "tool_input": {}},
        {"tool_name": SQL},
        {"tool_name": SQL, "tool_input": "select 1"},
    ])
    def test_unreadable_input_exits_2(self, stdin, tmp_path):
        r = run_active(stdin, tmp_path)
        assert r.returncode == 2
        assert "ASK GUARD" in r.stderr

    def test_allowed_call_exits_2_when_it_cannot_be_recorded(self, tmp_path):
        # 기록하지 못한 허용은 호출자가 대조할 수 없으므로 막는다.
        (tmp_path / ".oncall").write_text("폴더 자리에 놓인 파일")
        r = run_active({"tool_name": SQL, "tool_input": {"query": query("account")}}, tmp_path)
        assert r.returncode == 2
        assert "ASK GUARD" in r.stderr

    def test_decisions_are_appended_in_order(self, tmp_path):
        run_active({"tool_name": SQL, "tool_input": {"query": query("account")}}, tmp_path)
        run_active({"tool_name": SQL, "tool_input": {"query": "select 1"}}, tmp_path)
        run_active({"tool_name": POSTHOG, "tool_input": {"command": "info query-logs"}}, tmp_path)
        assert ledger(tmp_path) == [
            f"allow\t{SQL}\taccount",
            f"block\t{SQL}\t",
            f"allow\t{POSTHOG}\tinfo query-logs",
        ]


# ---------------------------------------------------------------------------
# .claude/settings.json 에 등록된 MCP PreToolUse 훅
# ---------------------------------------------------------------------------

def run_configured_hooks(tool, tool_input, tmp_path, **extra_env):
    """설정 파일에서 이 도구 이름에 걸리는 훅을 Claude Code처럼 stdin JSON으로 실행하고 종료 코드를 모은다."""
    settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
    hooks = [
        hook["command"]
        for entry in settings["hooks"]["PreToolUse"] if re.fullmatch(entry["matcher"], tool)
        for hook in entry["hooks"]
    ]
    payload = json.dumps({"tool_name": tool, "tool_input": tool_input})
    # 명령은 프로젝트의 스크립트를 가리키게 하고, 기록은 임시 폴더에 남게 한다.
    return [
        subprocess.run(
            hook.replace("$CLAUDE_PROJECT_DIR", str(PROJECT_ROOT)), shell=True, input=payload,
            capture_output=True, text=True, cwd=tmp_path, env=hook_env(CLAUDE_PROJECT_DIR=str(tmp_path), **extra_env),
        ).returncode
        for hook in hooks
    ]


class TestConfiguredHook:
    @pytest.mark.parametrize("tool,tool_input", [
        (SQL, {"query": "select * from public.transactions"}),
        (POSTHOG, {"command": "call dashboard-create {}"}),
        ("mcp__vercel__get_runtime_logs", {}),
        ("mcp__supabase__apply_migration", {"name": "x", "query": "select 1"}),
    ])
    def test_blocks_in_ask_session(self, tool, tool_input, tmp_path):
        codes = run_configured_hooks(tool, tool_input, tmp_path, ONCALL_ASK_ACTIVE="1", ONCALL_ASK_USER_ID=USER)
        assert codes == [2]

    def test_allows_template_query_in_ask_session(self, tmp_path):
        codes = run_configured_hooks(
            SQL, {"query": query("account")}, tmp_path, ONCALL_ASK_ACTIVE="1", ONCALL_ASK_USER_ID=USER,
        )
        assert codes == [0]

    def test_passes_everything_outside_ask_session(self, tmp_path):
        assert run_configured_hooks(SQL, {"query": "select * from public.transactions"}, tmp_path) == [0]

    def test_does_not_run_for_builtin_tools(self, tmp_path):
        for tool in ("Read", "Grep", "Glob", "ToolSearch"):
            assert run_configured_hooks(tool, {}, tmp_path, ONCALL_ASK_ACTIVE="1") == []


# ---------------------------------------------------------------------------
# .claude/skills/oncall/ask.md — 스킬에 적힌 쿼리와 훅의 템플릿
# ---------------------------------------------------------------------------

class TestSkillTemplates:
    def test_skill_lists_exactly_the_guard_templates(self):
        blocks = re.findall(r"^```sql\n(.*?)\n```$", ASK_SKILL.read_text(encoding="utf-8"), re.DOTALL | re.MULTILINE)
        assert sorted(blocks) == sorted(guard.SQL_TEMPLATES.values())

    def test_skill_names_every_template_and_posthog_tool(self):
        text = ASK_SKILL.read_text(encoding="utf-8")
        for name in (*guard.SQL_TEMPLATES, *guard.POSTHOG_TOOLS):
            assert f"`{name}`" in text
