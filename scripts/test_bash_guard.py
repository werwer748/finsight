"""
bash_guard.py 테스트.
되돌리기 어려운 명령어 패턴이 담긴 Bash 호출을 막는 로직과 훅 입출력 규약을 검증한다.
명령어는 문자열로만 넘기며 실제로 실행하지 않는다.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import bash_guard as guard

SCRIPT = Path(__file__).parent / "bash_guard.py"
PROJECT_ROOT = Path(__file__).parent.parent
SETTINGS = PROJECT_ROOT / ".claude" / "settings.json"
CODEX_HOOKS = PROJECT_ROOT / ".codex" / "hooks.json"

DANGEROUS = [
    "rm -rf node_modules",
    "rm   -rf build",
    "git push --force origin main",
    "git reset --hard HEAD~1",
    'psql -c "DROP TABLE users;"',
    "npm run lint && git reset --hard",
]
HARMLESS = [
    "npm run test",
    "git status",
    "git push origin main",
    "rm notes.txt",
]


# ---------------------------------------------------------------------------
# check()
# ---------------------------------------------------------------------------

class TestCheck:
    @pytest.mark.parametrize("command", DANGEROUS)
    def test_blocks_dangerous_command(self, command):
        msg = guard.check(command)
        assert msg is not None
        assert "BLOCKED" in msg

    @pytest.mark.parametrize("command", HARMLESS)
    def test_allows_harmless_command(self, command):
        assert guard.check(command) is None


# ---------------------------------------------------------------------------
# main() — 훅으로 실행될 때의 입출력
# ---------------------------------------------------------------------------

def hook_env(**extra):
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_TOOL_INPUT"}
    env.update(extra)
    return env


def run_hook(payload, **extra_env):
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload), capture_output=True, text=True, env=hook_env(**extra_env),
    )


class TestMain:
    @pytest.mark.parametrize("command", DANGEROUS)
    def test_dangerous_command_exits_2_with_message(self, command):
        r = run_hook({"tool_name": "Bash", "tool_input": {"command": command}})
        assert r.returncode == 2
        assert "BLOCKED" in r.stderr

    @pytest.mark.parametrize("command", HARMLESS)
    def test_harmless_command_exits_0(self, command):
        r = run_hook({"tool_name": "Bash", "tool_input": {"command": command}})
        assert r.returncode == 0
        assert r.stderr == ""

    def test_reads_command_from_stdin_not_env(self):
        payload = {"tool_name": "Bash", "tool_input": {"command": "git status"}}
        r = run_hook(payload, CLAUDE_TOOL_INPUT="git reset --hard")
        assert r.returncode == 0

    def test_payload_without_command_exits_0(self):
        r = run_hook({"tool_name": "Bash", "tool_input": {}})
        assert r.returncode == 0


# ---------------------------------------------------------------------------
# .claude/settings.json 에 등록된 Bash PreToolUse 훅
# ---------------------------------------------------------------------------

def run_configured_hooks(command, config=SETTINGS):
    """설정 파일의 Bash 훅을 Claude Code·Codex처럼 stdin JSON으로 실행하고 종료 코드를 모은다."""
    settings = json.loads(config.read_text(encoding="utf-8"))
    hooks = [
        hook["command"]
        for entry in settings["hooks"]["PreToolUse"] if entry["matcher"] == "Bash"
        for hook in entry["hooks"]
    ]
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    return [
        subprocess.run(
            hook, shell=True, input=payload, capture_output=True, text=True,
            cwd=PROJECT_ROOT, env=hook_env(CLAUDE_PROJECT_DIR=str(PROJECT_ROOT)),
        ).returncode
        for hook in hooks
    ]


class TestConfiguredHook:
    @pytest.mark.parametrize("command", DANGEROUS)
    def test_blocks_dangerous_command_with_exit_2(self, command):
        assert 2 in run_configured_hooks(command)

    @pytest.mark.parametrize("command", HARMLESS)
    def test_allows_harmless_command(self, command):
        codes = run_configured_hooks(command)
        assert codes
        assert all(code == 0 for code in codes)


# ---------------------------------------------------------------------------
# .codex/hooks.json 에 등록된 Bash PreToolUse 훅
# ---------------------------------------------------------------------------

class TestCodexConfiguredHook:
    @pytest.mark.parametrize("command", DANGEROUS)
    def test_blocks_dangerous_command_with_exit_2(self, command):
        assert 2 in run_configured_hooks(command, CODEX_HOOKS)

    @pytest.mark.parametrize("command", HARMLESS)
    def test_allows_harmless_command(self, command):
        codes = run_configured_hooks(command, CODEX_HOOKS)
        assert codes
        assert all(code == 0 for code in codes)
