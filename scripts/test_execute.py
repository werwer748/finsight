"""
execute.py 리팩터링 안전망 테스트.
리팩터링 전후 동작이 동일한지 검증한다.
"""

import json
import os
import subprocess
import sys
import textwrap
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import execute as ex


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_project(tmp_path):
    """phases/, CLAUDE.md, docs/ 를 갖춘 임시 프로젝트 구조."""
    phases_dir = tmp_path / "phases"
    phases_dir.mkdir()

    claude_md = tmp_path / "CLAUDE.md"
    claude_md.write_text("# Rules\n- rule one\n- rule two")

    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "arch.md").write_text("# Architecture\nSome content")
    (docs_dir / "guide.md").write_text("# Guide\nAnother doc")

    return tmp_path


@pytest.fixture
def phase_dir(tmp_project):
    """step 3개를 가진 phase 디렉토리."""
    d = tmp_project / "phases" / "0-mvp"
    d.mkdir()

    index = {
        "project": "TestProject",
        "phase": "mvp",
        "steps": [
            {"step": 0, "name": "setup", "status": "completed", "summary": "프로젝트 초기화 완료"},
            {"step": 1, "name": "core", "status": "completed", "summary": "핵심 로직 구현"},
            {"step": 2, "name": "ui", "status": "pending"},
        ],
    }
    (d / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False))
    (d / "step2.md").write_text("# Step 2: UI\n\nUI를 구현하세요.")

    return d


@pytest.fixture
def top_index(tmp_project):
    """phases/index.json (top-level)."""
    top = {
        "phases": [
            {"dir": "0-mvp", "status": "pending"},
            {"dir": "1-polish", "status": "pending"},
        ]
    }
    p = tmp_project / "phases" / "index.json"
    p.write_text(json.dumps(top, indent=2))
    return p


@pytest.fixture
def executor(tmp_project, phase_dir):
    """테스트용 StepExecutor 인스턴스. git 호출은 별도 mock 필요."""
    with patch.object(ex, "ROOT", tmp_project):
        inst = ex.StepExecutor("0-mvp")
    # 내부 경로를 tmp_project 기준으로 재설정
    inst._root = str(tmp_project)
    inst._phases_dir = tmp_project / "phases"
    inst._phase_dir = phase_dir
    inst._phase_dir_name = "0-mvp"
    inst._index_file = phase_dir / "index.json"
    inst._top_index_file = tmp_project / "phases" / "index.json"
    return inst


# ---------------------------------------------------------------------------
# _stamp (= 이전 now_iso)
# ---------------------------------------------------------------------------

class TestStamp:
    def test_returns_kst_timestamp(self, executor):
        result = executor._stamp()
        assert "+0900" in result

    def test_format_is_iso(self, executor):
        result = executor._stamp()
        dt = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert dt.tzinfo is not None

    def test_is_current_time(self, executor):
        before = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0)
        result = executor._stamp()
        after = datetime.now(ex.StepExecutor.TZ).replace(microsecond=0) + timedelta(seconds=1)
        parsed = datetime.strptime(result, "%Y-%m-%dT%H:%M:%S%z")
        assert before <= parsed <= after


# ---------------------------------------------------------------------------
# _read_json / _write_json
# ---------------------------------------------------------------------------

class TestJsonHelpers:
    def test_roundtrip(self, tmp_path):
        data = {"key": "값", "nested": [1, 2, 3]}
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, data)
        loaded = ex.StepExecutor._read_json(p)
        assert loaded == data

    def test_save_ensures_ascii_false(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"한글": "테스트"})
        raw = p.read_text()
        assert "한글" in raw
        assert "\\u" not in raw

    def test_save_indented(self, tmp_path):
        p = tmp_path / "test.json"
        ex.StepExecutor._write_json(p, {"a": 1})
        raw = p.read_text()
        assert "\n" in raw

    def test_load_nonexistent_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            ex.StepExecutor._read_json(tmp_path / "nope.json")


# ---------------------------------------------------------------------------
# _load_guardrails
# ---------------------------------------------------------------------------

class TestLoadGuardrails:
    def test_loads_claude_md_and_docs(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "# Rules" in result
        assert "rule one" in result
        assert "# Architecture" in result
        assert "# Guide" in result

    def test_sections_separated_by_divider(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "---" in result

    def test_docs_sorted_alphabetically(self, executor, tmp_project):
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        arch_pos = result.index("arch")
        guide_pos = result.index("guide")
        assert arch_pos < guide_pos

    def test_no_claude_md(self, executor, tmp_project):
        (tmp_project / "CLAUDE.md").unlink()
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "CLAUDE.md" not in result
        assert "Architecture" in result

    def test_no_docs_dir(self, executor, tmp_project):
        import shutil
        shutil.rmtree(tmp_project / "docs")
        with patch.object(ex, "ROOT", tmp_project):
            result = executor._load_guardrails()
        assert "Rules" in result
        assert "Architecture" not in result

    def test_empty_project(self, tmp_path):
        with patch.object(ex, "ROOT", tmp_path):
            # executor가 필요 없는 static-like 동작이므로 임시 인스턴스
            phases_dir = tmp_path / "phases" / "dummy"
            phases_dir.mkdir(parents=True)
            idx = {"project": "T", "phase": "t", "steps": []}
            (phases_dir / "index.json").write_text(json.dumps(idx))
            inst = ex.StepExecutor.__new__(ex.StepExecutor)
            result = inst._load_guardrails()
        assert result == ""


# ---------------------------------------------------------------------------
# _build_step_context
# ---------------------------------------------------------------------------

class TestBuildStepContext:
    def test_includes_completed_with_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert "Step 0 (setup): 프로젝트 초기화 완료" in result
        assert "Step 1 (core): 핵심 로직 구현" in result

    def test_excludes_pending(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert "ui" not in result

    def test_excludes_completed_without_summary(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        del index["steps"][0]["summary"]
        result = ex.StepExecutor._build_step_context(index)
        assert "setup" not in result
        assert "core" in result

    def test_empty_when_no_completed(self):
        index = {"steps": [{"step": 0, "name": "a", "status": "pending"}]}
        result = ex.StepExecutor._build_step_context(index)
        assert result == ""

    def test_has_header(self, phase_dir):
        index = json.loads((phase_dir / "index.json").read_text())
        result = ex.StepExecutor._build_step_context(index)
        assert result.startswith("## 이전 Step 산출물")


# ---------------------------------------------------------------------------
# _build_preamble
# ---------------------------------------------------------------------------

class TestBuildPreamble:
    def test_includes_project_name(self, executor):
        result = executor._build_preamble("", "")
        assert "TestProject" in result

    def test_includes_guardrails(self, executor):
        result = executor._build_preamble("GUARD_CONTENT", "")
        assert "GUARD_CONTENT" in result

    def test_includes_step_context(self, executor):
        ctx = "## 이전 Step 산출물\n\n- Step 0: done"
        result = executor._build_preamble("", ctx)
        assert "이전 Step 산출물" in result

    def test_includes_commit_example(self, executor):
        result = executor._build_preamble("", "")
        assert "feat(mvp):" in result

    def test_includes_rules(self, executor):
        result = executor._build_preamble("", "")
        assert "작업 규칙" in result
        assert "AC" in result

    def test_no_retry_section_by_default(self, executor):
        result = executor._build_preamble("", "")
        assert "이전 시도 실패" not in result

    def test_retry_section_with_prev_error(self, executor):
        result = executor._build_preamble("", "", prev_error="타입 에러 발생")
        assert "이전 시도 실패" in result
        assert "타입 에러 발생" in result

    def test_includes_max_retries(self, executor):
        result = executor._build_preamble("", "")
        assert str(ex.StepExecutor.MAX_RETRIES) in result

    def test_includes_index_path(self, executor):
        result = executor._build_preamble("", "")
        assert "/phases/0-mvp/index.json" in result


# ---------------------------------------------------------------------------
# _update_top_index
# ---------------------------------------------------------------------------

class TestUpdateTopIndex:
    def test_completed(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "completed"
        assert "completed_at" in mvp

    def test_error(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("error")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "error"
        assert "failed_at" in mvp

    def test_blocked(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("blocked")
        data = json.loads(top_index.read_text())
        mvp = next(p for p in data["phases"] if p["dir"] == "0-mvp")
        assert mvp["status"] == "blocked"
        assert "blocked_at" in mvp

    def test_other_phases_unchanged(self, executor, top_index):
        executor._top_index_file = top_index
        executor._update_top_index("completed")
        data = json.loads(top_index.read_text())
        polish = next(p for p in data["phases"] if p["dir"] == "1-polish")
        assert polish["status"] == "pending"

    def test_nonexistent_dir_is_noop(self, executor, top_index):
        executor._top_index_file = top_index
        executor._phase_dir_name = "no-such-dir"
        original = json.loads(top_index.read_text())
        executor._update_top_index("completed")
        after = json.loads(top_index.read_text())
        for p_before, p_after in zip(original["phases"], after["phases"]):
            assert p_before["status"] == p_after["status"]

    def test_no_top_index_file(self, executor, tmp_path):
        executor._top_index_file = tmp_path / "nonexistent.json"
        executor._update_top_index("completed")  # should not raise


# ---------------------------------------------------------------------------
# _checkout_branch (mocked)
# ---------------------------------------------------------------------------

class TestCheckoutBranch:
    def _mock_git(self, executor, responses):
        call_idx = {"i": 0}
        def fake_git(*args):
            idx = call_idx["i"]
            call_idx["i"] += 1
            if idx < len(responses):
                return responses[idx]
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

    def test_already_on_branch(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="feat-mvp\n", stderr=""),
        ])
        executor._checkout_branch()  # should return without checkout

    def test_branch_exists_checkout(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_branch_not_exists_create(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="not found"),
            MagicMock(returncode=0, stdout="", stderr=""),
        ])
        executor._checkout_branch()

    def test_checkout_fails_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=0, stdout="main\n", stderr=""),
            MagicMock(returncode=1, stdout="", stderr=""),
            MagicMock(returncode=1, stdout="", stderr="dirty tree"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 1

    def test_no_git_exits(self, executor):
        self._mock_git(executor, [
            MagicMock(returncode=1, stdout="", stderr="not a git repo"),
        ])
        with pytest.raises(SystemExit) as exc_info:
            executor._checkout_branch()
        assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# _commit_step (mocked)
# ---------------------------------------------------------------------------

class TestCommitStep:
    def test_two_phase_commit(self, executor):
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_calls = [c for c in calls if c[0] == "commit"]
        assert len(commit_calls) == 2
        assert "feat(mvp):" in commit_calls[0][2]
        assert "chore(mvp):" in commit_calls[1][2]

    def test_no_code_changes_skips_feat_commit(self, executor):
        call_count = {"diff": 0}
        calls = []
        def fake_git(*args):
            calls.append(args)
            if args[:2] == ("diff", "--cached"):
                call_count["diff"] += 1
                if call_count["diff"] == 1:
                    return MagicMock(returncode=0)
                return MagicMock(returncode=1)
            return MagicMock(returncode=0, stdout="", stderr="")
        executor._run_git = fake_git

        executor._commit_step(2, "ui")

        commit_msgs = [c[2] for c in calls if c[0] == "commit"]
        assert len(commit_msgs) == 1
        assert "chore" in commit_msgs[0]


# ---------------------------------------------------------------------------
# _invoke_codex (mocked)
# ---------------------------------------------------------------------------

class TestInvokeCodex:
    def test_invokes_codex_with_correct_args(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"result": "ok"}', stderr="")
        step = {"step": 2, "name": "ui"}
        preamble = "PREAMBLE\n"

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            output = executor._invoke_codex(step, preamble)

        cmd = mock_run.call_args[0][0]
        assert cmd[:2] == ["codex", "exec"]
        assert "--dangerously-bypass-approvals-and-sandbox" in cmd
        assert "--dangerously-bypass-hook-trust" in cmd
        assert "--json" in cmd
        assert "PREAMBLE" in cmd[-1]
        assert "UI를 구현하세요" in cmd[-1]

    def test_saves_output_json(self, executor):
        mock_result = MagicMock(returncode=0, stdout='{"ok": true}', stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result):
            executor._invoke_codex(step, "preamble")

        output_file = executor._phase_dir / "step2-output.json"
        assert output_file.exists()
        data = json.loads(output_file.read_text())
        assert data["step"] == 2
        assert data["name"] == "ui"
        assert data["exitCode"] == 0

    def test_nonexistent_step_file_exits(self, executor):
        step = {"step": 99, "name": "nonexistent"}
        with pytest.raises(SystemExit) as exc_info:
            executor._invoke_codex(step, "preamble")
        assert exc_info.value.code == 1

    def test_timeout_is_1800(self, executor):
        mock_result = MagicMock(returncode=0, stdout="{}", stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            executor._invoke_codex(step, "preamble")

        assert mock_run.call_args[1]["timeout"] == 1800

    def test_does_not_inherit_stdin(self, executor):
        mock_result = MagicMock(returncode=0, stdout="{}", stderr="")
        step = {"step": 2, "name": "ui"}

        with patch("subprocess.run", return_value=mock_result) as mock_run:
            executor._invoke_codex(step, "preamble")

        assert mock_run.call_args[1]["stdin"] == subprocess.DEVNULL


# ---------------------------------------------------------------------------
# _invoke_codex — 제한 시간 초과 (mocked)
# ---------------------------------------------------------------------------

OUTPUT_KEYS = {"step", "name", "exitCode", "stdout", "stderr"}


def codex_timeout(stdout=None, stderr=None):
    """제한 시간을 넘긴 subprocess.run 대역. 실제 예외처럼 프롬프트가 든 명령어를 담아 던진다."""
    def fake_run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"], output=stdout, stderr=stderr)
    return fake_run


class TestInvokeCodexTimeout:
    STEP = {"step": 2, "name": "ui"}

    @pytest.mark.parametrize("stdout, stderr", [
        (b"partial out", b"partial err"),
        ("partial out", "partial err"),
    ])
    def test_returns_failed_result_with_partial_output(self, executor, stdout, stderr):
        with patch("subprocess.run", side_effect=codex_timeout(stdout, stderr)):
            output = executor._invoke_codex(self.STEP, "preamble")

        assert output["exitCode"] != 0
        assert output["stdout"] == "partial out"
        assert "partial err" in output["stderr"]
        assert "1800초" in output["stderr"]

    def test_no_partial_output(self, executor):
        with patch("subprocess.run", side_effect=codex_timeout()):
            output = executor._invoke_codex(self.STEP, "preamble")

        assert output["exitCode"] != 0
        assert output["stdout"] == ""
        assert "1800초" in output["stderr"]

    def test_undecodable_bytes_do_not_raise(self, executor):
        with patch("subprocess.run", side_effect=codex_timeout(b"\xff\xfe out", b"")):
            output = executor._invoke_codex(self.STEP, "preamble")

        assert output["stdout"].endswith(" out")

    def test_saves_output_json_with_same_keys(self, executor):
        with patch("subprocess.run", side_effect=codex_timeout(b"partial out", b"partial err")):
            output = executor._invoke_codex(self.STEP, "preamble")

        data = json.loads((executor._phase_dir / "step2-output.json").read_text())
        assert set(data) == OUTPUT_KEYS
        assert data == output
        assert data["step"] == 2
        assert data["name"] == "ui"

    def test_does_not_record_prompt(self, executor):
        with patch("subprocess.run", side_effect=codex_timeout(b"partial out", b"partial err")):
            executor._invoke_codex(self.STEP, "SECRET_PREAMBLE\n")

        raw = (executor._phase_dir / "step2-output.json").read_text()
        assert "SECRET_PREAMBLE" not in raw
        assert "UI를 구현하세요" not in raw


# ---------------------------------------------------------------------------
# _execute_single_step (git·Codex mocked)
# ---------------------------------------------------------------------------

def read_step(executor, step_num=2):
    index = json.loads(executor._index_file.read_text())
    return next(s for s in index["steps"] if s["step"] == step_num)


def scripted_codex(executor, outcomes):
    """subprocess.run 대역. 호출마다 outcome 하나를 꺼내 step 2의 index 항목을 고치고 결과를 돌려준다.

    outcome은 (index에 쓸 필드, 종료 코드 또는 "timeout"). outcome이 바닥나면 테스트가 실패한다.
    calls에는 호출 시점의 프롬프트, step status, 그때까지의 커밋 횟수를 남긴다.
    """
    remaining = list(outcomes)
    calls = []

    def fake_run(cmd, **kwargs):
        assert cmd[0] == "codex", f"unexpected process: {cmd[0]}"
        index = json.loads(executor._index_file.read_text())
        step = next(s for s in index["steps"] if s["step"] == 2)
        calls.append({
            "prompt": cmd[-1],
            "status": step["status"],
            "commits": executor._commit_step.call_count,
        })
        fields, result = remaining.pop(0)
        step.update(fields)
        executor._index_file.write_text(json.dumps(index, ensure_ascii=False))
        if result == "timeout":
            raise subprocess.TimeoutExpired(
                cmd, kwargs["timeout"], output=b"partial out", stderr=b"partial err",
            )
        return MagicMock(returncode=result, stdout="out", stderr="boom" if result else "")

    return fake_run, calls


@pytest.fixture
def stepper(executor, top_index):
    """git을 건드리지 못하게 막은 executor. Codex는 테스트마다 scripted_codex로 대체한다."""
    executor._run_git = MagicMock(side_effect=AssertionError("git must not run in tests"))
    executor._commit_step = MagicMock()
    return executor


class TestExecuteSingleStep:
    STEP = {"step": 2, "name": "ui", "status": "pending"}
    DONE = {"status": "completed", "summary": "UI 구현"}
    MAX = ex.StepExecutor.MAX_RETRIES

    def _top_status(self, top_index):
        data = json.loads(top_index.read_text())
        return next(p for p in data["phases"] if p["dir"] == "0-mvp")["status"]

    def test_exit_zero_and_completed_is_success(self, stepper):
        fake_run, calls = scripted_codex(stepper, [(self.DONE, 0)])

        with patch("subprocess.run", side_effect=fake_run):
            assert stepper._execute_single_step(self.STEP, "") is True

        assert len(calls) == 1
        step = read_step(stepper)
        assert step["status"] == "completed"
        assert "completed_at" in step
        stepper._commit_step.assert_called_once_with(2, "ui")

    def test_nonzero_exit_with_completed_status_is_retried(self, stepper):
        fake_run, calls = scripted_codex(stepper, [(self.DONE, 1), (self.DONE, 0)])

        with patch("subprocess.run", side_effect=fake_run):
            assert stepper._execute_single_step(self.STEP, "") is True

        assert len(calls) == 2
        assert "이전 시도 실패" not in calls[0]["prompt"]
        assert "이전 시도 실패" in calls[1]["prompt"]
        assert "(code 1)" in calls[1]["prompt"]
        # 첫 시도는 커밋되지 않고 pending으로 되돌려진 뒤 재시도된다.
        assert calls[1]["commits"] == 0
        assert calls[1]["status"] == "pending"
        stepper._commit_step.assert_called_once_with(2, "ui")

    def test_nonzero_exit_with_completed_status_exhausts_retries(self, stepper, top_index):
        fake_run, calls = scripted_codex(stepper, [(self.DONE, 1)] * (self.MAX + 1))

        with patch("subprocess.run", side_effect=fake_run):
            with pytest.raises(SystemExit) as exc_info:
                stepper._execute_single_step(self.STEP, "")

        assert exc_info.value.code == 1
        assert len(calls) == self.MAX
        step = read_step(stepper)
        assert step["status"] == "error"
        assert f"[{self.MAX}회 시도 후 실패]" in step["error_message"]
        assert "(code 1)" in step["error_message"]
        assert "failed_at" in step
        assert "completed_at" not in step
        assert self._top_status(top_index) == "error"

    def test_nonzero_exit_keeps_step_error_message(self, stepper):
        failed = {"status": "error", "error_message": "타입 에러"}
        fake_run, calls = scripted_codex(stepper, [(failed, 1), (self.DONE, 0)])

        with patch("subprocess.run", side_effect=fake_run):
            assert stepper._execute_single_step(self.STEP, "") is True

        assert "(code 1)" in calls[1]["prompt"]
        assert "타입 에러" in calls[1]["prompt"]

    def test_status_never_updated_exhausts_retries(self, stepper, top_index):
        fake_run, calls = scripted_codex(stepper, [({}, 0)] * (self.MAX + 1))

        with patch("subprocess.run", side_effect=fake_run):
            with pytest.raises(SystemExit) as exc_info:
                stepper._execute_single_step(self.STEP, "")

        assert exc_info.value.code == 1
        assert len(calls) == self.MAX
        assert all("Step did not update status" in c["prompt"] for c in calls[1:])
        step = read_step(stepper)
        assert step["status"] == "error"
        assert step["error_message"] == f"[{self.MAX}회 시도 후 실패] Step did not update status"
        assert "failed_at" in step
        assert self._top_status(top_index) == "error"

    @pytest.mark.parametrize("exit_code", [0, 1])
    def test_blocked_exits_2_without_retry(self, stepper, top_index, exit_code):
        blocked = {"status": "blocked", "blocked_reason": "API 키 필요"}
        fake_run, calls = scripted_codex(stepper, [(blocked, exit_code), (self.DONE, 0)])

        with patch("subprocess.run", side_effect=fake_run):
            with pytest.raises(SystemExit) as exc_info:
                stepper._execute_single_step(self.STEP, "")

        assert exc_info.value.code == 2
        assert len(calls) == 1
        step = read_step(stepper)
        assert step["status"] == "blocked"
        assert step["blocked_reason"] == "API 키 필요"
        assert "blocked_at" in step
        assert self._top_status(top_index) == "blocked"
        stepper._commit_step.assert_not_called()

    def test_timeout_is_retried_with_reason(self, stepper):
        fake_run, calls = scripted_codex(stepper, [({}, "timeout"), (self.DONE, 0)])

        with patch("subprocess.run", side_effect=fake_run):
            assert stepper._execute_single_step(self.STEP, "") is True

        assert len(calls) == 2
        assert "이전 시도 실패" in calls[1]["prompt"]
        assert "1800초" in calls[1]["prompt"]
        stepper._commit_step.assert_called_once_with(2, "ui")

    def test_timeout_with_completed_status_is_not_success(self, stepper):
        fake_run, calls = scripted_codex(stepper, [(self.DONE, "timeout"), (self.DONE, 0)])

        with patch("subprocess.run", side_effect=fake_run):
            assert stepper._execute_single_step(self.STEP, "") is True

        assert len(calls) == 2
        assert calls[1]["commits"] == 0
        assert calls[1]["status"] == "pending"

    def test_timeout_exhausts_retries_and_records_error(self, stepper, top_index):
        fake_run, calls = scripted_codex(stepper, [({}, "timeout")] * (self.MAX + 1))

        with patch("subprocess.run", side_effect=fake_run):
            with pytest.raises(SystemExit) as exc_info:
                stepper._execute_single_step(self.STEP, "")

        assert exc_info.value.code == 1
        assert len(calls) == self.MAX
        step = read_step(stepper)
        assert step["status"] == "error"
        assert f"[{self.MAX}회 시도 후 실패]" in step["error_message"]
        assert "1800초" in step["error_message"]
        assert "failed_at" in step
        # 커밋되는 index에는 프롬프트나 프로세스 출력을 남기지 않는다.
        assert "UI를 구현하세요" not in step["error_message"]
        assert "partial" not in step["error_message"]
        assert self._top_status(top_index) == "error"

        output = json.loads((stepper._phase_dir / "step2-output.json").read_text())
        assert set(output) == OUTPUT_KEYS
        assert output["exitCode"] != 0
        assert output["stdout"] == "partial out"
        assert "partial err" in output["stderr"]


# ---------------------------------------------------------------------------
# progress_indicator (= 이전 Spinner)
# ---------------------------------------------------------------------------

class TestProgressIndicator:
    def test_context_manager(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.15)
        assert pi.elapsed >= 0.1

    def test_elapsed_increases(self):
        import time
        with ex.progress_indicator("test") as pi:
            time.sleep(0.2)
        assert pi.elapsed > 0


# ---------------------------------------------------------------------------
# main() CLI 파싱 (mocked)
# ---------------------------------------------------------------------------

class TestMainCli:
    def test_no_args_exits(self):
        with patch("sys.argv", ["execute.py"]):
            with pytest.raises(SystemExit) as exc_info:
                ex.main()
            assert exc_info.value.code == 2  # argparse exits with 2

    def test_invalid_phase_dir_exits(self):
        with patch("sys.argv", ["execute.py", "nonexistent"]):
            with patch.object(ex, "ROOT", Path("/tmp/fake_nonexistent")):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 1

    def test_missing_index_exits(self, tmp_project):
        (tmp_project / "phases" / "empty").mkdir()
        with patch("sys.argv", ["execute.py", "empty"]):
            with patch.object(ex, "ROOT", tmp_project):
                with pytest.raises(SystemExit) as exc_info:
                    ex.main()
                assert exc_info.value.code == 1

    def test_steps_run_with_review_skipped(self, monkeypatch):
        monkeypatch.setenv("SKIP_REVIEW", "0")
        seen = {}
        with patch("sys.argv", ["execute.py", "0-mvp"]):
            with patch.object(ex, "StepExecutor") as mock_cls:
                mock_cls.return_value.run.side_effect = lambda: seen.update(skip=os.environ["SKIP_REVIEW"])
                ex.main()
        assert seen == {"skip": "1"}


# ---------------------------------------------------------------------------
# _check_blockers (= 이전 main() error/blocked 체크)
# ---------------------------------------------------------------------------

class TestCheckBlockers:
    def _make_executor_with_steps(self, tmp_project, steps):
        d = tmp_project / "phases" / "test-phase"
        d.mkdir(exist_ok=True)
        index = {"project": "T", "phase": "test", "steps": steps}
        (d / "index.json").write_text(json.dumps(index))

        with patch.object(ex, "ROOT", tmp_project):
            inst = ex.StepExecutor.__new__(ex.StepExecutor)
        inst._root = str(tmp_project)
        inst._phases_dir = tmp_project / "phases"
        inst._phase_dir = d
        inst._phase_dir_name = "test-phase"
        inst._index_file = d / "index.json"
        inst._top_index_file = tmp_project / "phases" / "index.json"
        inst._phase_name = "test"
        inst._total = len(steps)
        return inst

    def test_error_step_exits_1(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "bad", "status": "error", "error_message": "fail"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 1

    def test_blocked_step_exits_2(self, tmp_project):
        steps = [
            {"step": 0, "name": "ok", "status": "completed"},
            {"step": 1, "name": "stuck", "status": "blocked", "blocked_reason": "API key"},
        ]
        inst = self._make_executor_with_steps(tmp_project, steps)
        with pytest.raises(SystemExit) as exc_info:
            inst._check_blockers()
        assert exc_info.value.code == 2
