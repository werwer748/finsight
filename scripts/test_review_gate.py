"""
review_gate.py 테스트.
/review-code 보고의 판정을 읽어 종료 코드를 정하는 로직과, 리뷰를 건너뛰는 조건을 검증한다.
claude와 git은 실제로 띄우지 않고 subprocess.run을 mock으로 대체한다.
"""

import json
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import review_gate as gate

PROJECT_ROOT = Path(__file__).parent.parent
SETTINGS = PROJECT_ROOT / ".claude" / "settings.json"
PRE_COMMIT = PROJECT_ROOT / ".githooks" / "pre-commit"
WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "review-code.yml"

VERDICT_LINES = {
    "🔴": "## 리뷰 결과: 🔴 위험 — 머지 금지",
    "🟠": "## 리뷰 결과: 🟠 경고 — 머지 전 수정",
    "🟡": "## 리뷰 결과: 🟡 주의 — 수정 권장",
    "🟢": "## 리뷰 결과: 🟢 양호 — 발견 없음",
}


def report(stage, suffix="", counts=(0, 0, 0)):
    red, orange, yellow = counts
    return f"{VERDICT_LINES[stage]}{suffix}\n🔴 {red} · 🟠 {orange} · 🟡 {yellow}    기준 staged · 파일 1개\n"


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

    def test_failed_run_has_no_stage_even_with_a_report_inside(self):
        assert gate.parse_report(f"{gate.NOT_RUN}\n\n{report('🟢')}") == (None, False)


# ---------------------------------------------------------------------------
# parse_counts()
# ---------------------------------------------------------------------------

class TestParseCounts:
    def test_reads_counts_line(self):
        assert gate.parse_counts(report("🔴", counts=(1, 1, 3))) == (1, 1, 3)

    def test_counts_line_with_merged_duplicates_note(self):
        text = "## 리뷰 결과: 🟡 주의 — 수정 권장\n🔴 0 · 🟠 0 · 🟡 12    기준 main · 파일 4개 (중복 1건 합침)\n"
        assert gate.parse_counts(text) == (0, 0, 12)

    @pytest.mark.parametrize("text", ["", "리뷰할 변경이 없습니다.", "## 리뷰 결과: ⚫ 리뷰를 실행하지 못했습니다"])
    def test_report_without_counts_line(self, text):
        assert gate.parse_counts(text) is None


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
# decide()
# ---------------------------------------------------------------------------

class TestDecide:
    @pytest.mark.parametrize("stage, counts", [
        ("🟢", (0, 0, 0)),
        ("🟡", (0, 0, 1)),
        ("🟡", (0, 0, 2)),
    ])
    def test_merges_when_at_most_two_cautions(self, stage, counts):
        assert gate.decide(stage, False, counts) == "merge"

    @pytest.mark.parametrize("stage, failed, counts", [
        ("🟡", False, (0, 0, 3)),
        ("🟠", False, (0, 1, 0)),
        ("🟠", False, (0, 2, 0)),
        ("🔴", False, (1, 0, 0)),
        ("🟡", True, (0, 0, 1)),
    ])
    def test_holds_for_a_person_to_judge(self, stage, failed, counts):
        assert gate.decide(stage, failed, counts) == "hold"

    @pytest.mark.parametrize("stage, failed, counts", [
        ("🔴", False, (2, 0, 0)),
        ("🔴", False, (3, 1, 5)),
        ("🔴", True, (2, 0, 0)),
    ])
    def test_rejects_two_or_more_dangers(self, stage, failed, counts):
        assert gate.decide(stage, failed, counts) == "reject"

    @pytest.mark.parametrize("stage, counts", [
        (None, None),
        (None, (0, 0, 0)),
        ("🟢", None),
        # 판정 줄과 건수 줄이 어긋난 보고로는 머지하지도 닫지도 않는다.
        ("🟢", (2, 0, 0)),
        ("🔴", (0, 0, 0)),
        ("🟡", (0, 0, 0)),
    ])
    def test_holds_when_report_is_unreadable_or_inconsistent(self, stage, counts):
        assert gate.decide(stage, False, counts) == "hold"


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

    def test_skipped_review_writes_no_decision(self, monkeypatch, tmp_path):
        # 판정이 없으면 워크플로우는 머지도 닫기도 하지 않는다.
        monkeypatch.setenv("SKIP_REVIEW", "1")
        out_file = tmp_path / "github_output"
        with patch("subprocess.run", fake_run(result=report("🟢"))):
            assert gate.main(["--base", "origin/main", "--decision-output", str(out_file)]) == 0
        assert not out_file.exists()

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

    def test_allows_only_subagents_and_the_merge_base_lookup(self, monkeypatch):
        # Read 규칙이 있으면 프로젝트 밖 파일(/proc의 환경변수 등)까지 읽힌다.
        cmd, _ = self.run_main(["--staged"], monkeypatch)
        assert cmd[cmd.index("--allowedTools") + 1:] == ["Agent", "Bash(git merge-base *)"]

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

    def test_token_like_strings_are_masked_in_report(self, capsys):
        leaked = report("🟡") + "- 환경변수 값: sk-ant-oat01-AbC_123-xyz\n"
        with patch("subprocess.run", fake_run(result=leaked)):
            assert gate.main(["--staged"]) == 0
        out = capsys.readouterr().out
        assert "sk-ant-oat01" not in out
        assert VERDICT_LINES["🟡"] in out

    def test_requires_staged_or_base(self):
        with pytest.raises(SystemExit) as exc_info:
            gate.main([])
        assert exc_info.value.code == 2

    @pytest.mark.parametrize("stage, counts, decision", [
        ("🟡", (0, 0, 2), "merge"),
        ("🟠", (0, 1, 0), "hold"),
        ("🔴", (2, 0, 0), "reject"),
    ])
    def test_decision_output_gets_decision_and_report_gets_note(self, stage, counts, decision, tmp_path, capsys):
        out_file = tmp_path / "github_output"
        out_file.write_text("other=1\n", encoding="utf-8")
        with patch("subprocess.run", fake_run(result=report(stage, counts=counts))):
            gate.main(["--base", "origin/main", "--decision-output", str(out_file)])
        assert out_file.read_text(encoding="utf-8") == f"other=1\ndecision={decision}\n"
        out = capsys.readouterr().out
        assert VERDICT_LINES[stage] in out
        assert gate.DECISION_NOTES[decision] in out

    def test_review_that_could_not_run_is_held(self, tmp_path):
        out_file = tmp_path / "github_output"
        with patch("subprocess.run", fake_run(stdout="not json")):
            gate.main(["--base", "origin/main", "--strict", "--decision-output", str(out_file)])
        assert out_file.read_text(encoding="utf-8") == "decision=hold\n"

    def test_failed_run_is_held_even_with_a_clean_report_inside(self, tmp_path):
        out_file = tmp_path / "github_output"
        with patch("subprocess.run", fake_run(result=report("🟢"), returncode=1)):
            code = gate.main(["--base", "origin/main", "--strict", "--decision-output", str(out_file)])
        assert code == 1
        assert out_file.read_text(encoding="utf-8") == "decision=hold\n"

    def test_no_decision_note_without_decision_output(self, capsys):
        with patch("subprocess.run", fake_run(result=report("🟢"))):
            gate.main(["--staged"])
        assert "머지 판정" not in capsys.readouterr().out


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


# ---------------------------------------------------------------------------
# .github/workflows/review-code.yml
# ---------------------------------------------------------------------------

class TestWorkflow:
    text = WORKFLOW.read_text(encoding="utf-8")

    def test_review_step_writes_decision_to_job_output(self):
        assert '--decision-output "$GITHUB_OUTPUT"' in self.text
        assert "decision: ${{ steps.review.outputs.decision }}" in self.text

    def test_closes_only_on_reject(self):
        assert "if: always() && steps.review.outputs.decision == 'reject'" in self.text
        assert self.text.count("gh pr close") == 1

    def test_auto_merge_waits_for_review_and_tests(self):
        assert "needs: [review-code, test]" in self.text
        assert "if: ${{ needs.review-code.outputs.decision == 'merge' &&" in self.text

    def test_auto_merges_only_into_the_default_branch(self):
        # base가 다른 PR을 리뷰한 뒤 base를 main으로 바꿔 리뷰하지 않은 커밋을 넣지 못하게 한다.
        assert "github.base_ref == github.event.repository.default_branch" in self.text

    def test_lists_old_paths_of_moved_files(self):
        # CLAUDE.md를 docs/로 옮긴 PR도 보호 경로를 고친 것으로 봐야 한다.
        expression = re.search(r"--jq '([^']+)'", self.text).group(1)
        files = [
            {"filename": "docs/moved.md", "previous_filename": "CLAUDE.md", "status": "renamed"},
            {"filename": "src/lib/a.ts", "status": "modified"},
        ]
        r = subprocess.run(["jq", "-r", expression], input=json.dumps(files), capture_output=True, text=True)
        assert r.stdout.splitlines() == ["docs/moved.md", "CLAUDE.md", "src/lib/a.ts"]


# ---------------------------------------------------------------------------
# auto-merge job의 Merge 스텝 — gh는 가짜로 대체해 스크립트를 실제로 실행한다
# ---------------------------------------------------------------------------

MERGE_COMMAND = "pr merge https://github.com/o/r/pull/7 --merge --match-head-commit abc123\n"


def run_merge_step(tmp_path, files, changed_files=None, api_fails=False):
    """Merge 스텝을 실행해 (종료 코드, 가짜 gh가 받은 머지 명령 또는 None)을 돌려준다."""
    text = WORKFLOW.read_text(encoding="utf-8")
    job = text[text.index("\n  auto-merge:"):]
    script = textwrap.dedent(job.split("        run: |\n", 1)[1])

    fake_gh = tmp_path / "gh"
    fake_gh.write_text(
        "#!/bin/sh\n"
        'case "$1" in\n'
        '  api) [ -n "$FAKE_API_FAILS" ] && exit 1; printf "%s" "$FAKE_FILES" ;;\n'
        '  pr) echo "$*" > "$FAKE_MERGE_LOG" ;;\n'
        "esac\n"
    )
    fake_gh.chmod(0o755)
    log = tmp_path / "merge.log"
    env = dict(
        os.environ,
        PATH=f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
        REPO="o/r", PR_NUMBER="7", PR_URL="https://github.com/o/r/pull/7", HEAD_SHA="abc123",
        CHANGED_FILES=str(len(files) if changed_files is None else changed_files),
        PROTECTED=re.search(r"PROTECTED: '(.+)'", job).group(1),
        FAKE_FILES="\n".join(files), FAKE_MERGE_LOG=str(log), FAKE_API_FAILS="1" if api_fails else "",
    )
    r = subprocess.run(["bash", "-e", "-c", script], capture_output=True, text=True, env=env)
    return r.returncode, log.read_text(encoding="utf-8") if log.exists() else None


class TestMergeStep:
    def test_merges_the_reviewed_commit(self, tmp_path):
        files = ["src/lib/a.ts", "src/scripts/a.ts", "docs/ADR.md"]
        assert run_merge_step(tmp_path, files) == (0, MERGE_COMMAND)

    # 이 파일들을 고친 PR은 고친 판으로 자기 자신을 심사한 것이다. lockfile은 리뷰어가 읽지 않는다.
    @pytest.mark.parametrize("path", [
        ".github/workflows/review-code.yml",
        ".githooks/pre-commit",
        ".claude/settings.json",
        ".claude/skills/review-code/SKILL.md",
        ".codex/hooks.json",
        "scripts/review_gate.py",
        "CLAUDE.md",
        "CLAUDE.local.md",
        "docs/CLAUDE.md",
        "package.json",
        "package-lock.json",
        ".npmrc",
    ])
    def test_leaves_changes_to_review_setup_and_dependencies_to_a_person(self, tmp_path, path):
        assert run_merge_step(tmp_path, ["src/lib/a.ts", path]) == (0, None)

    def test_does_not_merge_when_file_list_is_empty(self, tmp_path):
        assert run_merge_step(tmp_path, []) == (0, None)

    def test_does_not_merge_when_file_list_may_be_truncated(self, tmp_path):
        assert run_merge_step(tmp_path, ["src/lib/a.ts"], changed_files=3000) == (0, None)

    def test_fails_without_merging_when_file_list_is_unavailable(self, tmp_path):
        code, merged = run_merge_step(tmp_path, ["src/lib/a.ts"], api_fails=True)
        assert code != 0
        assert merged is None
