"""
review_gate.py 테스트.
/review-code 보고의 판정을 읽어 종료 코드를 정하는 로직과, 리뷰를 건너뛰는 조건을 검증한다.
claude와 git은 실제로 띄우지 않고 subprocess.run을 mock으로 대체한다.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import review_gate as gate

PROJECT_ROOT = Path(__file__).parent.parent
SETTINGS = PROJECT_ROOT / ".claude" / "settings.json"
PRE_COMMIT = PROJECT_ROOT / ".githooks" / "pre-commit"

VERDICT_LINES = {
    "🔴": "## 리뷰 결과: 🔴 위험 — 머지 금지",
    "🟠": "## 리뷰 결과: 🟠 경고 — 머지 전 수정",
    "🟡": "## 리뷰 결과: 🟡 주의 — 수정 권장",
    "🟢": "## 리뷰 결과: 🟢 양호 — 발견 없음",
}


def report(stage, suffix=""):
    return f"{VERDICT_LINES[stage]}{suffix}\n🔴 0 · 🟠 0 · 🟡 0    기준 staged · 파일 1개\n"


# ---------------------------------------------------------------------------
# parse_report()
# ---------------------------------------------------------------------------

class TestParseReport:
    @pytest.mark.parametrize("stage", list(VERDICT_LINES))
    def test_reads_stage_from_verdict_line(self, stage):
        assert gate.parse_report(report(stage)) == (stage, False)

    def test_verdict_line_after_other_text(self):
        assert gate.parse_report("리뷰를 마쳤습니다.\n\n" + report("🟠")) == ("🟠", False)

    def test_no_changes_is_green(self):
        assert gate.parse_report("리뷰할 변경이 없습니다.") == ("🟢", False)

    def test_failed_dimensions_are_flagged(self):
        text = report("🟡", " (리뷰 실패 1개 차원)")
        assert gate.parse_report(text) == ("🟡", True)

    @pytest.mark.parametrize("text", ["", "API Error: 529", "## 리뷰 결과: ⚫ 리뷰를 실행하지 못했습니다"])
    def test_unreadable_report_has_no_stage(self, text):
        assert gate.parse_report(text)[0] is None


# ---------------------------------------------------------------------------
# exit_code()
# ---------------------------------------------------------------------------

class TestExitCode:
    @pytest.mark.parametrize("stage, failed, expected", [
        ("🔴", False, 1),
        ("🟠", False, 0),
        ("🟡", False, 0),
        ("🟢", False, 0),
        (None, False, 0),
        ("🟡", True, 0),
        ("🔴", True, 1),
    ])
    def test_local_blocks_only_danger(self, stage, failed, expected):
        assert gate.exit_code(stage, failed, fail_on="danger", strict=False) == expected

    @pytest.mark.parametrize("stage, failed, expected", [
        ("🔴", False, 1),
        ("🟠", False, 1),
        ("🟡", False, 0),
        ("🟢", False, 0),
        (None, False, 1),
        ("🟡", True, 1),
    ])
    def test_ci_blocks_warning_and_incomplete_review(self, stage, failed, expected):
        assert gate.exit_code(stage, failed, fail_on="warning", strict=True) == expected


# ---------------------------------------------------------------------------
# main() — claude와 git은 mock
# ---------------------------------------------------------------------------

def fake_run(staged="src/lib/a.ts\0", result=None, returncode=0, raises=None, stdout=None):
    """git에는 staged 파일 목록을, claude에는 JSON 결과를 돌려주는 subprocess.run 대역."""
    def run(cmd, **kwargs):
        if cmd[0] == "git":
            return MagicMock(returncode=0, stdout=staged, stderr="")
        if raises:
            raise raises
        out = stdout if stdout is not None else json.dumps({"result": result, "is_error": returncode != 0})
        return MagicMock(returncode=returncode, stdout=out, stderr="")
    return MagicMock(side_effect=run)


def claude_calls(mock_run):
    return [c for c in mock_run.call_args_list if c[0][0][0] == "claude"]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("SKIP_REVIEW", "REVIEW_GATE_ACTIVE"):
        monkeypatch.delenv(name, raising=False)


class TestSkip:
    @pytest.mark.parametrize("name", ["SKIP_REVIEW", "REVIEW_GATE_ACTIVE"])
    def test_env_flag_skips_without_running_anything(self, monkeypatch, name):
        monkeypatch.setenv(name, "1")
        with patch("subprocess.run", fake_run(result=report("🔴"))) as mock_run:
            assert gate.main(["--staged"]) == 0
        assert mock_run.call_count == 0

    @pytest.mark.parametrize("staged", [
        "",
        "docs/ADR.md\0",
        "CLAUDE.md\0phases/1-dashboard/index.json\0.claude/skills/review-code/SKILL.md\0",
        "docs/한글 문서.md\0",
    ])
    def test_staged_without_reviewable_files_skips(self, staged):
        with patch("subprocess.run", fake_run(staged=staged, result=report("🔴"))) as mock_run:
            assert gate.main(["--staged"]) == 0
        assert claude_calls(mock_run) == []

    def test_staged_with_code_among_docs_runs_review(self):
        with patch("subprocess.run", fake_run(staged="docs/ADR.md\0src/lib/a.ts\0", result=report("🟢"))) as mock_run:
            assert gate.main(["--staged"]) == 0
        assert len(claude_calls(mock_run)) == 1

    def test_lists_staged_files_nul_separated(self):
        with patch("subprocess.run", fake_run(staged="docs/ADR.md\0")) as mock_run:
            gate.main(["--staged"])
        assert mock_run.call_args_list[0][0][0] == ["git", "diff", "--cached", "--name-only", "-z"]

    def test_base_mode_does_not_filter_by_staged_files(self):
        with patch("subprocess.run", fake_run(staged="", result=report("🟢"))) as mock_run:
            assert gate.main(["--base", "origin/main"]) == 0
        assert len(claude_calls(mock_run)) == 1


class TestClaudeInvocation:
    def run_main(self, argv, monkeypatch):
        monkeypatch.setenv("CLAUDECODE", "1")
        with patch("subprocess.run", fake_run(result=report("🟢"))) as mock_run:
            gate.main(argv)
        (call,) = claude_calls(mock_run)
        return call[0][0], call[1]

    def test_staged_runs_skill_with_staged_argument(self, monkeypatch):
        cmd, _ = self.run_main(["--staged"], monkeypatch)
        assert cmd[:3] == ["claude", "-p", "/review-code --staged"]

    def test_base_runs_skill_with_ref(self, monkeypatch):
        cmd, _ = self.run_main(["--base", "origin/main"], monkeypatch)
        assert cmd[:3] == ["claude", "-p", "/review-code origin/main"]

    def test_runs_headless_with_json_output_and_no_prompts(self, monkeypatch):
        cmd, kwargs = self.run_main(["--staged"], monkeypatch)
        assert cmd[cmd.index("--output-format") + 1] == "json"
        assert cmd[cmd.index("--permission-mode") + 1] == "dontAsk"
        assert kwargs["stdin"] == subprocess.DEVNULL
        assert kwargs["timeout"] == gate.CLAUDE_TIMEOUT

    def test_timeout_argument_overrides_default(self, monkeypatch):
        _, kwargs = self.run_main(["--staged", "--timeout", "540"], monkeypatch)
        assert kwargs["timeout"] == 540

    def test_allows_only_reading_and_the_merge_base_lookup(self, monkeypatch):
        cmd, _ = self.run_main(["--staged"], monkeypatch)
        assert cmd[cmd.index("--allowedTools") + 1:] == ["Read", "Agent", "Bash(git merge-base *)"]

    def test_child_env_marks_review_session_and_drops_nesting_flag(self, monkeypatch):
        _, kwargs = self.run_main(["--staged"], monkeypatch)
        assert kwargs["env"]["REVIEW_GATE_ACTIVE"] == "1"
        assert "CLAUDECODE" not in kwargs["env"]


class TestMain:
    def test_danger_blocks_and_prints_report(self, capsys):
        with patch("subprocess.run", fake_run(result=report("🔴"))):
            assert gate.main(["--staged"]) == 1
        assert VERDICT_LINES["🔴"] in capsys.readouterr().out

    def test_warning_passes_locally(self, capsys):
        with patch("subprocess.run", fake_run(result=report("🟠"))):
            assert gate.main(["--staged"]) == 0
        assert VERDICT_LINES["🟠"] in capsys.readouterr().out

    def test_warning_fails_in_ci(self):
        with patch("subprocess.run", fake_run(result=report("🟠"))):
            assert gate.main(["--base", "origin/main", "--fail-on", "warning", "--strict"]) == 1

    @pytest.mark.parametrize("failure", [
        dict(raises=FileNotFoundError("claude")),
        dict(raises=PermissionError("claude")),
        dict(raises=subprocess.TimeoutExpired("claude", gate.CLAUDE_TIMEOUT)),
        dict(result="Credit balance is too low", returncode=1),
        dict(stdout="not json"),
        dict(stdout="[]"),
    ])
    def test_review_that_could_not_run(self, failure, capsys):
        with patch("subprocess.run", fake_run(**failure)):
            assert gate.main(["--staged"]) == 0
        assert "## 리뷰 결과: ⚫" in capsys.readouterr().out

        with patch("subprocess.run", fake_run(**failure)):
            assert gate.main(["--staged", "--strict"]) == 1

    def test_requires_staged_or_base(self):
        with pytest.raises(SystemExit) as exc_info:
            gate.main([])
        assert exc_info.value.code == 2


# ---------------------------------------------------------------------------
# .claude/settings.json 의 Stop 훅 — 리뷰 세션에서는 lint·build·test를 돌리지 않는다
# ---------------------------------------------------------------------------

def run_stop_hooks(tmp_path, **extra_env):
    """Stop 훅을 실행한다. 진짜 npm이 돌지 않도록 실패하는 가짜 npm을 PATH 앞에 둔다."""
    fake_npm = tmp_path / "npm"
    fake_npm.write_text("#!/bin/sh\nexit 1\n")
    fake_npm.chmod(0o755)

    settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
    hooks = [hook["command"] for entry in settings["hooks"]["Stop"] for hook in entry["hooks"]]
    env = {k: v for k, v in os.environ.items() if k != "REVIEW_GATE_ACTIVE"}
    env.update(PATH=f"{tmp_path}{os.pathsep}{env['PATH']}", CLAUDE_PROJECT_DIR=str(PROJECT_ROOT), **extra_env)
    return [
        subprocess.run(
            hook, shell=True, input=json.dumps({"stop_hook_active": False}),
            capture_output=True, text=True, cwd=PROJECT_ROOT, env=env,
        ).returncode
        for hook in hooks
    ]


class TestConfiguredStopHook:
    def test_runs_checks_in_normal_session(self, tmp_path):
        assert run_stop_hooks(tmp_path) == [2]

    def test_exits_immediately_in_review_session(self, tmp_path):
        assert run_stop_hooks(tmp_path, REVIEW_GATE_ACTIVE="1") == [0]


# ---------------------------------------------------------------------------
# .githooks/pre-commit
# ---------------------------------------------------------------------------

class TestPreCommitHook:
    def test_is_executable(self):
        assert os.access(PRE_COMMIT, os.X_OK)

    def test_runs_gate_on_staged_changes_blocking_danger(self):
        text = PRE_COMMIT.read_text(encoding="utf-8")
        assert "scripts/review_gate.py" in text
        assert "--staged" in text
        assert "--fail-on danger" in text

    def test_gives_up_before_the_ten_minute_bash_limit(self):
        assert "--timeout 540" in PRE_COMMIT.read_text(encoding="utf-8")
