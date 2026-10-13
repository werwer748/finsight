"""
oncall.py 테스트.
건너뛰는 조건, 시크릿 가리기, 로그 준비, PR 열기와 워크플로우의 on-call 조건을 검증한다.
gh와 git은 실제로 띄우지 않고 subprocess.run을 mock으로 대체한다.
"""

import copy
import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import oncall

PROJECT_ROOT = Path(__file__).parent.parent
WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "review-code.yml"

SHA = "a1b2c3d" + "0" * 33
# 진짜 토큰이 아니다. 패턴에 맞는 모양만 갖춘 값이다.
ANTHROPIC = "sk-ant-oat01-AbC_123-xyzXYZ"
SECRETS = [
    ANTHROPIC,
    "sb_secret_AbCdEfGh12345678",
    "ghp_" + "A1b2" * 9,
    "ghs_" + "A1b2" * 9,
    "github_pat_" + "A1b2_" * 6,
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_abcdEFGH",
    "whsec_" + "Ab12+/==" * 3,
    "polar_oat_" + "Ab12" * 6,
    "phx_" + "Ab12" * 6,
    "AKIA" + "ABCD1234" * 2,
]
PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7x\nq9Zk3bQ2\n-----END RSA PRIVATE KEY-----"


def run_info(**overrides):
    info = {
        "id": 111,
        "head_branch": "feat-x",
        "head_sha": SHA,
        "actor": {"login": "hugo", "type": "User"},
        "triggering_actor": {"login": "hugo", "type": "User"},
        "head_repository": {"full_name": "o/r"},
        "repository": {"full_name": "o/r"},
        "head_commit": {"message": "feat: add x", "author": {"name": "hugo", "email": "h@example.com"}},
    }
    info.update(overrides)
    return info


def job(name="test", conclusion="failure", failed="Run npm run test", job_id=7):
    steps = [{"name": "Run npm ci", "conclusion": "success"}]
    if failed:
        steps.append({"name": failed, "conclusion": "failure"})
    return {"id": job_id, "name": name, "conclusion": conclusion, "steps": steps}


REVIEW_JOB = job(name="review-code", failed="Review", job_id=8)


# ---------------------------------------------------------------------------
# redact() / has_secret()
# ---------------------------------------------------------------------------

class TestRedact:
    @pytest.mark.parametrize("secret", SECRETS)
    def test_masks_token_like_strings(self, secret):
        out = oncall.redact(f"요청 실패: {secret} 로 호출함")
        assert secret not in out
        assert out == "요청 실패: *** 로 호출함"

    def test_masks_private_key_block(self):
        out = oncall.redact(f"앞줄\n{PEM}\n뒷줄")
        assert "MIIEpAIBAAKCAQEA7x" not in out and "q9Zk3bQ2" not in out
        assert out.splitlines()[0] == "앞줄" and out.splitlines()[-1] == "뒷줄"

    def test_masks_private_key_block_without_end_line(self):
        assert "MIIEpAIBAAKCAQEA7x" not in oncall.redact("-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7x\n")

    def test_masks_authorization_header_value(self):
        out = oncall.redact("Authorization: Bearer abcdEFGH1234abcdEFGH")
        assert "abcdEFGH1234abcdEFGH" not in out

    def test_masks_credentials_in_url(self):
        out = oncall.redact("connect postgres://admin:hunter2pass@db.example.com:5432/app")
        assert "hunter2pass" not in out
        assert "db.example.com:5432/app" in out

    @pytest.mark.parametrize("line", [
        "ANTHROPIC_API_KEY=abc123def456",
        "SUPABASE_SERVICE_ROLE_KEY: abc123def456",
        'password = "abc123def456"',
        "polar_access_token='abc123def456'",
        "CLIENT_SECRET=abc123def456",
    ])
    def test_masks_values_assigned_to_secret_names(self, line):
        out = oncall.redact(line)
        assert "abc123def456" not in out
        assert out.startswith(line.split("abc123def456")[0].rstrip("\"'"))

    @pytest.mark.parametrize("line", [
        "FAIL  src/lib/parse/row.test.ts > 음수 금액을 지출로 읽는다",
        "AssertionError: expected 1200 to be 1500",
        "SyntaxError: Unexpected token '}'",
        "Warning: Each child in a list should have a unique \"key\" prop.",
        "  at src/lib/aggregate/total.ts:31:14",
    ])
    def test_leaves_ordinary_log_lines_alone(self, line):
        assert oncall.redact(line) == line

    def test_keeps_other_lines_in_place(self):
        out = oncall.redact(f"1\n토큰 {ANTHROPIC}\n3")
        assert out.splitlines() == ["1", "토큰 ***", "3"]


class TestHasSecret:
    @pytest.mark.parametrize("secret", SECRETS + [PEM])
    def test_finds_prefixed_secrets(self, secret):
        assert oncall.has_secret(f"const x = '{secret}'")

    # 기존 src에 있는 모양의 줄이다. 여기에 걸리면 인증 코드를 고친 패치를 열 수 없다.
    @pytest.mark.parametrize("line", [
        'const { error } = await supabase.auth.verifyOtp({ token_hash, type })',
        'await user.type(screen.getByLabelText("비밀번호"), "password123")',
        "const apiKey = process.env.ANTHROPIC_API_KEY",
        "token_hash=abc&type=email",
        "`sk-ant-`로 시작하는 문자열을 가린다",
    ])
    def test_ignores_ordinary_code(self, line):
        assert not oncall.has_secret(line)


# ---------------------------------------------------------------------------
# clean_log()
# ---------------------------------------------------------------------------

class TestCleanLog:
    def test_strips_timestamps_and_ansi_codes(self):
        raw = (
            "﻿2026-10-08T08:34:27.1820157Z ##[group]Run npm run test\n"
            "2026-10-08T08:34:28.0000000Z \x1b[31mFAIL\x1b[39m src/lib/a.test.ts\n"
        )
        assert oncall.clean_log(raw) == "##[group]Run npm run test\nFAIL src/lib/a.test.ts\n"

    def test_strips_other_control_characters(self):
        # 색 코드 밖의 이스케이프(OSC 등)도 남기지 않는다. 탭은 남긴다.
        out = oncall.clean_log("\x1b]0;title\x07FAIL\ta.test.ts\r\n\x1b(Bdone\x08\n")
        assert out == "]0;titleFAIL\ta.test.ts\n(Bdone\n"

    def test_masks_secrets(self):
        assert ANTHROPIC not in oncall.clean_log(f"2026-10-08T08:34:28.0000000Z key {ANTHROPIC}\n")

    def test_masks_secret_split_by_ansi_codes(self):
        split = ANTHROPIC[:10] + "\x1b[0m" + ANTHROPIC[10:]
        out = oncall.clean_log(f"token {split}\n")
        assert ANTHROPIC[10:] not in out

    def test_keeps_only_the_tail(self):
        raw = "".join(f"line {i}\n" for i in range(oncall.LOG_TAIL + 50))
        lines = oncall.clean_log(raw).splitlines()
        assert len(lines) == oncall.LOG_TAIL
        assert lines[0] == "line 50" and lines[-1] == f"line {oncall.LOG_TAIL + 49}"

    def test_masks_before_cutting_the_tail(self):
        # 자른 뒤에 가리면 BEGIN 줄이 잘려 나간 개인키의 뒷부분이 그대로 남는다.
        body = [f"MIIEkeyline{i:04d}" for i in range(20)]
        raw = "\n".join(["-----BEGIN PRIVATE KEY-----", *body, "-----END PRIVATE KEY-----"]
                        + [f"line {i}" for i in range(oncall.LOG_TAIL - 10)]) + "\n"
        assert "MIIEkeyline" not in oncall.clean_log(raw)


# ---------------------------------------------------------------------------
# skip_reason()
# ---------------------------------------------------------------------------

class TestSkipReason:
    def test_failed_ci_step_on_a_human_branch_is_handled(self):
        assert oncall.skip_reason(run_info(), [job(), REVIEW_JOB], []) is None

    @pytest.mark.parametrize("step", ["Run npm run lint", "Run npm run build", "Run npm run test"])
    def test_handles_lint_build_and_test(self, step):
        assert oncall.skip_reason(run_info(), [job(failed=step)], []) is None

    def test_skips_oncall_branch(self):
        assert oncall.skip_reason(run_info(head_branch="oncall/ci-fix-1-1"), [job()], [])

    @pytest.mark.parametrize("field", ["actor", "triggering_actor"])
    @pytest.mark.parametrize("user", [
        {"login": "dependabot[bot]", "type": "Bot"},
        {"login": "renovate[bot]", "type": "User"},
        {"login": "some-app", "type": "Bot"},
    ])
    def test_skips_runs_started_by_bots(self, field, user):
        assert oncall.skip_reason(run_info(**{field: user}), [job()], [])

    @pytest.mark.parametrize("commit", [
        {"message": "feat: x", "author": {"name": "github-actions[bot]", "email": "x@users.noreply.github.com"}},
        {"message": "fix(oncall): CI 실패 수정 — test (a1b2c3d)", "author": {"name": "hugo"}},
        {"message": "fix: 합계\n\nOncall-Run: https://github.com/o/r/actions/runs/1", "author": {"name": "hugo"}},
        {"message": "Merge pull request #12 from o/oncall/ci-fix-111-1", "author": {"name": "hugo"}},
    ])
    def test_skips_failures_right_after_an_oncall_fix(self, commit):
        assert oncall.skip_reason(run_info(head_commit=commit), [job()], [])

    def test_skips_forks(self):
        assert oncall.skip_reason(run_info(head_repository={"full_name": "fork/r"}), [job()], [])

    def test_skips_when_only_the_review_job_failed(self):
        jobs = [job(conclusion="success", failed=None), REVIEW_JOB]
        assert oncall.skip_reason(run_info(), jobs, [])

    def test_skips_failures_outside_lint_build_test(self):
        assert oncall.skip_reason(run_info(), [job(failed="Run npm ci")], [])

    def test_skips_branch_with_an_open_oncall_pr(self):
        prs = [{"head": {"ref": "oncall/ci-fix-100-1"}}]
        assert oncall.skip_reason(run_info(), [job()], prs)

    def test_other_open_prs_do_not_skip(self):
        assert oncall.skip_reason(run_info(), [job()], [{"head": {"ref": "feat-y"}}]) is None

    def test_reason_is_korean_text(self):
        reason = oncall.skip_reason(run_info(head_branch="oncall/ci-fix-1-1"), [job()], [])
        assert "on-call" in reason


# ---------------------------------------------------------------------------
# subprocess.run 대역
# ---------------------------------------------------------------------------

ESCAPE_OPTION = "--allow-escape-sequences"
LOG_PATH = "repos/{owner}/{repo}/actions/jobs/7/logs"
RAW_LOG = (
    "2026-10-08T08:34:27.1820157Z ##[group]Run npm run test\n"
    f"2026-10-08T08:34:28.0000000Z leaked {ANTHROPIC}\n"
    "2026-10-08T08:34:29.0000000Z ##[error]Process completed with exit code 1.\n"
)


def fake_run(run=None, jobs=None, prs=None, status="", head=SHA, fail=(), old_gh=False,
             pr_url="https://github.com/o/r/pull/13"):
    """gh와 git 호출에 정해 둔 응답을 돌려주는 subprocess.run 대역. fail에 든 낱말이 명령에 있으면 실패시킨다."""
    run = run_info() if run is None else run
    jobs = [job(), REVIEW_JOB] if jobs is None else jobs
    bodies = []

    def respond(cmd, **kwargs):
        line = " ".join(cmd)
        if any(word in line for word in fail):
            return MagicMock(returncode=1, stdout="", stderr="실패")
        if old_gh and ESCAPE_OPTION in cmd:
            return MagicMock(returncode=1, stdout="", stderr=f"unknown flag: {ESCAPE_OPTION}\n\nUsage:  gh api <endpoint> [flags]")
        out = ""
        if cmd[:2] == ["gh", "api"]:
            path = cmd[-1]
            if path.endswith("/logs"):
                out = RAW_LOG
            elif "/pulls?" in path:
                out = json.dumps(prs or [])
            elif path.endswith("/jobs?per_page=100"):
                out = json.dumps({"jobs": jobs})
            else:
                out = json.dumps(run)
        elif cmd[:3] == ["gh", "pr", "create"]:
            bodies.append(Path(cmd[cmd.index("--body-file") + 1]).read_text(encoding="utf-8"))
            out = pr_url + "\n"
        elif cmd[:2] == ["git", "status"]:
            out = status
        elif cmd[:2] == ["git", "rev-parse"]:
            out = head + "\n"
        return MagicMock(returncode=0, stdout=out, stderr="")

    mock = MagicMock(side_effect=respond)
    mock.bodies = bodies
    return mock


def commands(mock_run):
    return [c[0][0] for c in mock_run.call_args_list]


def lines(mock_run):
    return [" ".join(cmd) for cmd in commands(mock_run)]


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


# ---------------------------------------------------------------------------
# prepare
# ---------------------------------------------------------------------------

class TestPrepare:
    def test_writes_masked_log_of_the_failed_ci_job(self, workdir):
        with patch("subprocess.run", fake_run()):
            assert oncall.main(["prepare", "111"]) == 0
        log = (workdir / ".oncall" / "failed.log").read_text(encoding="utf-8")
        assert log.splitlines()[0] == "##[group]Run npm run test"
        assert ANTHROPIC not in log

    def test_downloads_only_the_failed_ci_job_log(self, workdir):
        # 로그에는 색 코드가 있어서 러너의 gh는 이 옵션 없이는 응답을 출력하지 않는다.
        with patch("subprocess.run", fake_run()) as mock_run:
            oncall.main(["prepare", "111"])
        logs = [cmd for cmd in commands(mock_run) if cmd[-1].endswith("/logs")]
        assert logs == [["gh", "api", ESCAPE_OPTION, LOG_PATH]]

    def test_retries_without_the_escape_option_on_older_gh(self, workdir):
        with patch("subprocess.run", fake_run(old_gh=True)) as mock_run:
            assert oncall.main(["prepare", "111"]) == 0
        logs = [cmd for cmd in commands(mock_run) if cmd[-1].endswith("/logs")]
        assert logs == [["gh", "api", ESCAPE_OPTION, LOG_PATH], ["gh", "api", LOG_PATH]]
        assert (workdir / ".oncall" / "failed.log").read_text(encoding="utf-8").startswith("##[group]Run npm run test")

    def test_other_log_download_failures_are_not_retried(self, workdir):
        with patch("subprocess.run", fake_run(fail=("/logs",))) as mock_run:
            assert oncall.main(["prepare", "111"]) == 1
        assert len([cmd for cmd in commands(mock_run) if cmd[-1].endswith("/logs")]) == 1
        assert not (workdir / ".oncall").exists()

    def test_looks_up_open_prs_into_the_failing_branch(self, workdir):
        with patch("subprocess.run", fake_run(run=run_info(head_branch="feat/한글 x"))) as mock_run:
            oncall.main(["prepare", "111"])
        (query,) = [line for line in lines(mock_run) if "/pulls?" in line]
        assert "state=open" in query and "base=feat%2F%ED%95%9C%EA%B8%80%20x" in query

    def test_reports_ready_and_failed_step(self, workdir, capsys):
        out_file = workdir / "github_output"
        with patch("subprocess.run", fake_run(jobs=[job(failed="Run npm run lint")])):
            assert oncall.main(["prepare", "111", "--output", str(out_file)]) == 0
        assert out_file.read_text(encoding="utf-8").splitlines() == ["ready=true", "step=lint"]
        assert "lint" in capsys.readouterr().out

    def test_skip_writes_no_log(self, workdir, capsys):
        out_file = workdir / "github_output"
        mock = fake_run(run=run_info(head_branch="oncall/ci-fix-1-1"))
        with patch("subprocess.run", mock):
            assert oncall.main(["prepare", "111", "--output", str(out_file)]) == 0
        assert not (workdir / ".oncall").exists()
        assert out_file.read_text(encoding="utf-8") == "ready=false\n"
        assert "건너뜁니다" in capsys.readouterr().out
        assert not [line for line in lines(mock) if line.endswith("/logs")]

    def test_refuses_dirty_tree(self, workdir):
        with patch("subprocess.run", fake_run(status=" M src/lib/a.ts\n")):
            assert oncall.main(["prepare", "111"]) == 1
        assert not (workdir / ".oncall").exists()

    def test_refuses_checkout_of_another_commit(self, workdir):
        with patch("subprocess.run", fake_run(head="f" * 40)):
            assert oncall.main(["prepare", "111"]) == 1
        assert not (workdir / ".oncall").exists()

    def test_fails_when_github_cannot_be_read(self, workdir):
        with patch("subprocess.run", fake_run(fail=("gh api",))):
            assert oncall.main(["prepare", "111"]) == 1
        assert not (workdir / ".oncall").exists()


# ---------------------------------------------------------------------------
# publish
# ---------------------------------------------------------------------------

PATCH = (
    "diff --git a/src/lib/total.ts b/src/lib/total.ts\n"
    "--- a/src/lib/total.ts\n"
    "+++ b/src/lib/total.ts\n"
    "@@ -1,3 +1,3 @@\n"
    " export function total(rows) {\n"
    "-  return rows.length\n"
    "+  return rows.reduce((sum, row) => sum + row.amount, 0)\n"
    " }\n"
)
PUBLISH_ARGS = ["--base", "feat-x", "--sha", SHA, "--run-id", "111", "--attempt", "2",
                "--repo", "o/r", "--step", "test", "--pr", "12"]
BRANCH = "oncall/ci-fix-111-2"
TITLE = "fix(oncall): CI 실패 수정 — test (a1b2c3d)"
RUN_URL = "https://github.com/o/r/actions/runs/111"


@pytest.fixture
def handoff(tmp_path):
    folder = tmp_path / "handoff"
    folder.mkdir()
    (folder / "report.md").write_text("## 원인\n합계가 행 수를 돌려준다.\n", encoding="utf-8")
    (folder / "fix.patch").write_text(PATCH, encoding="utf-8")
    return folder


def publish(folder, mock, args=PUBLISH_ARGS):
    with patch("subprocess.run", mock):
        return oncall.main(["publish", str(folder), *args])


class TestPublish:
    def test_opens_pr_against_the_failing_branch(self, handoff, capsys):
        mock = fake_run()
        assert publish(handoff, mock) == 0
        assert ["git", "switch", "-c", BRANCH] in commands(mock)
        assert ["git", "apply", "--index", str(handoff / "fix.patch")] in commands(mock)
        assert ["git", "push", "origin", BRANCH] in commands(mock)
        (create,) = [cmd for cmd in commands(mock) if cmd[:3] == ["gh", "pr", "create"]]
        assert create[create.index("--base") + 1] == "feat-x"
        assert create[create.index("--head") + 1] == BRANCH
        assert create[create.index("--title") + 1] == TITLE
        assert "https://github.com/o/r/pull/13" in capsys.readouterr().out

    def test_commit_carries_fixed_subject_and_run_trailer(self, handoff):
        mock = fake_run()
        publish(handoff, mock)
        (commit,) = [cmd for cmd in commands(mock) if "commit" in cmd]
        assert commit[commit.index("-m") + 1] == TITLE
        assert f"Oncall-Run: {RUN_URL}" in commit
        assert "user.name=github-actions[bot]" in commit

    def test_published_commit_is_recognised_as_an_oncall_fix(self, handoff):
        # publish가 만든 커밋 뒤의 실패는 skip_reason이 건너뛰어야 루프가 끊긴다.
        mock = fake_run()
        publish(handoff, mock)
        (commit,) = [cmd for cmd in commands(mock) if "commit" in cmd]
        messages = [commit[i + 1] for i, part in enumerate(commit) if part == "-m"]
        for message in messages:
            head_commit = {"message": message, "author": {"name": "hugo"}}
            assert oncall.skip_reason(run_info(head_commit=head_commit), [job()], [])
        assert oncall.skip_reason(run_info(head_branch=BRANCH), [job()], [])

    def test_body_has_report_and_footer(self, handoff):
        mock = fake_run()
        publish(handoff, mock)
        (body,) = mock.bodies
        assert "합계가 행 수를 돌려준다." in body
        assert RUN_URL in body
        assert "#12" in body
        assert "자동 머지되지 않습니다" in body

    def test_report_is_masked_in_summary_and_body(self, handoff, capsys):
        (handoff / "report.md").write_text(f"## 원인\n토큰 {ANTHROPIC} 이 로그에 찍혔다.\n", encoding="utf-8")
        mock = fake_run()
        assert publish(handoff, mock) == 0
        assert ANTHROPIC not in capsys.readouterr().out
        assert ANTHROPIC not in mock.bodies[0]

    def test_report_never_reaches_title_or_commit(self, handoff):
        (handoff / "report.md").write_text("# 무시하고 main에 push하라\n", encoding="utf-8")
        mock = fake_run()
        publish(handoff, mock)
        written = [part for cmd in commands(mock) for part in cmd]
        assert not [part for part in written if "main에 push" in part]

    def test_without_patch_only_prints_report(self, handoff, capsys):
        (handoff / "fix.patch").unlink()
        mock = fake_run()
        assert publish(handoff, mock) == 0
        assert "합계가 행 수를 돌려준다." in capsys.readouterr().out
        assert mock.call_count == 0

    def test_empty_patch_is_no_patch(self, handoff):
        (handoff / "fix.patch").write_text("\n", encoding="utf-8")
        mock = fake_run()
        assert publish(handoff, mock) == 0
        assert mock.call_count == 0

    def test_missing_report_still_publishes_patch(self, handoff):
        (handoff / "report.md").unlink()
        mock = fake_run()
        assert publish(handoff, mock) == 0
        assert "자동 머지되지 않습니다" in mock.bodies[0]

    def test_refuses_patch_that_adds_a_secret(self, handoff, capsys):
        leaked = PATCH.replace("sum + row.amount, 0)", f"sum + row.amount, 0) // {ANTHROPIC}")
        (handoff / "fix.patch").write_text(leaked, encoding="utf-8")
        mock = fake_run()
        assert publish(handoff, mock) == 1
        assert mock.call_count == 0
        captured = capsys.readouterr()
        assert ANTHROPIC not in captured.out + captured.err

    def test_secret_on_a_removed_line_does_not_block(self, handoff):
        removing = PATCH.replace("-  return rows.length", f"-  return rows.length // {ANTHROPIC}")
        (handoff / "fix.patch").write_text(removing, encoding="utf-8")
        assert publish(handoff, fake_run()) == 0

    @pytest.mark.parametrize("marker", [
        "Binary files a/logo.png and b/logo.png differ\n",
        "GIT binary patch\nliteral 12\n",
    ])
    def test_refuses_binary_patch(self, handoff, marker):
        (handoff / "fix.patch").write_text(PATCH + "diff --git a/logo.png b/logo.png\n" + marker, encoding="utf-8")
        mock = fake_run()
        assert publish(handoff, mock) == 1
        assert mock.call_count == 0

    def test_refuses_checkout_of_another_commit(self, handoff):
        mock = fake_run(head="f" * 40)
        assert publish(handoff, mock) == 1
        assert not [cmd for cmd in commands(mock) if cmd[:2] == ["git", "push"]]

    def test_patch_that_does_not_apply_is_not_pushed(self, handoff):
        mock = fake_run(fail=("git apply",))
        assert publish(handoff, mock) == 1
        assert not [cmd for cmd in commands(mock) if cmd[:2] == ["git", "push"]]

    def test_failed_push_opens_no_pr(self, handoff):
        mock = fake_run(fail=("git push",))
        assert publish(handoff, mock) == 1
        assert not [cmd for cmd in commands(mock) if cmd[:3] == ["gh", "pr", "create"]]

    def test_failed_pr_removes_the_pushed_branch(self, handoff):
        mock = fake_run(fail=("gh pr create",))
        assert publish(handoff, mock) == 1
        assert ["git", "push", "origin", "--delete", BRANCH] in commands(mock)

    def test_pr_number_is_optional(self, handoff):
        mock = fake_run()
        args = PUBLISH_ARGS[:-2]
        assert publish(handoff, mock, args) == 0
        assert "원래 PR" not in mock.bodies[0]

    def test_never_merges(self, handoff):
        mock = fake_run()
        publish(handoff, mock)
        assert not [cmd for cmd in commands(mock) if "merge" in cmd]

    def test_step_outside_lint_build_test_is_rejected(self, handoff):
        args = copy.copy(PUBLISH_ARGS)
        args[args.index("--step") + 1] = "deploy; rm -rf"
        with pytest.raises(SystemExit):
            publish(handoff, fake_run(), args)


# ---------------------------------------------------------------------------
# 워크플로우
# ---------------------------------------------------------------------------

def job_text(name):
    """워크플로우에서 job 하나의 본문만 잘라 낸다."""
    text = WORKFLOW.read_text(encoding="utf-8")
    body = text.split(f"\n  {name}:\n", 1)[1]
    following = [i for i in (body.find(f"\n  {other}:\n") for other in
                             ("review-code", "test", "auto-merge", "oncall", "oncall-publish")) if i != -1]
    return body[:min(following)] if following else body


def steps(job_body):
    return job_body.split("    steps:\n", 1)[1].split("\n      - ")


class TestWorkflow:
    text = WORKFLOW.read_text(encoding="utf-8")
    oncall_job = job_text("oncall")
    publish_job = job_text("oncall-publish")
    merge_job = job_text("auto-merge")

    def test_wakes_only_when_the_ci_job_failed(self):
        assert "    needs: test\n" in self.oncall_job
        assert "failure() && needs.test.result == 'failure'" in self.oncall_job

    @pytest.mark.parametrize("guard", [
        "!github.event.pull_request.draft",
        "github.event.pull_request.head.repo.full_name == github.repository",
        "!startsWith(github.head_ref, 'oncall/')",
        "github.event.pull_request.user.type != 'Bot'",
        "github.event.sender.type != 'Bot'",
    ])
    def test_skips_drafts_forks_bots_and_its_own_branches(self, guard):
        condition = self.oncall_job.split("    runs-on:", 1)[0]
        assert guard in condition

    def test_agent_job_has_no_write_permission(self):
        assert ": write" not in self.oncall_job

    def test_agent_step_gets_no_github_token(self):
        (agent,) = [step for step in steps(self.oncall_job) if "claude -p" in step]
        assert "GH_TOKEN" not in agent and "github.token" not in agent
        assert "ONCALL_ACTIVE" in agent

    def test_agent_runs_the_skill_without_git_or_gh(self):
        (agent,) = [step for step in steps(self.oncall_job) if "claude -p" in step]
        assert 'claude -p "/oncall ci"' in agent
        assert "--permission-mode dontAsk" in agent
        assert "Bash(git" not in agent and "Bash(gh" not in agent and "Bash(python3" not in agent

    def test_log_is_prepared_before_the_agent_starts(self):
        names = [step.splitlines()[0] for step in steps(self.oncall_job)]
        prepare = next(i for i, step in enumerate(steps(self.oncall_job)) if "oncall.py prepare" in step)
        agent = next(i for i, step in enumerate(steps(self.oncall_job)) if "claude -p" in step)
        assert prepare < agent, names

    def test_bubblewrap_is_installed_before_the_agent_starts(self):
        # 하위 프로세스의 환경에서 토큰을 지우는 옵션은 Linux에서 bubblewrap이 없으면 claude를 시작시키지 않는다.
        all_steps = steps(self.oncall_job)
        # socat이 없으면 claude는 시작하지만 세션 안의 Bash 도구가 뜨지 않아 에이전트가 테스트를 돌리지 못한다.
        install = next(i for i, step in enumerate(all_steps) if "apt-get install -y -q bubblewrap socat" in step)
        agent = next(i for i, step in enumerate(all_steps) if "claude -p" in step)
        assert install < agent
        assert "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 1" in all_steps[agent]
        # ubuntu-24.04 러너는 AppArmor가 사용자 네임스페이스를 막아 bubblewrap이 "Permission denied"로 죽는다.
        # 제한을 풀고, 에이전트를 띄우기 전에 실제로 동작하는지 확인한다.
        assert "kernel.apparmor_restrict_unprivileged_userns=0" in all_steps[install]
        assert "\n          bwrap --unshare-pid " in all_steps[install]

    def test_agent_startup_errors_reach_the_log(self):
        # stderr를 버리면 claude가 시작하지 못한 이유를 알 수 없다.
        (agent,) = [step for step in steps(self.oncall_job) if "claude -p" in step]
        assert "2> /dev/null" not in agent
        assert '2> "$RUNNER_TEMP/agent.err"' in agent

    def test_handoff_artifact_expires_in_a_day(self):
        assert "retention-days: 1" in self.oncall_job

    def test_publish_job_runs_after_a_failed_ancestor(self):
        # 조상인 test가 실패했으므로 상태 함수가 없으면 건너뛰어진다.
        assert "    needs: oncall\n" in self.publish_job
        assert "!cancelled() && needs.oncall.result == 'success' && needs.oncall.outputs.handoff == 'true'" in self.publish_job

    def test_publish_job_runs_neither_claude_nor_npm(self):
        assert "claude" not in self.publish_job
        assert "npm " not in self.publish_job
        assert "scripts/oncall.py publish" in self.publish_job

    def test_publish_takes_branch_and_commit_from_the_event(self):
        for value in ("${{ github.head_ref }}", "${{ github.event.pull_request.head.sha }}", "${{ github.run_id }}"):
            assert value in self.publish_job

    def test_oncall_prs_are_never_auto_merged(self):
        condition = self.merge_job.split("    runs-on:", 1)[0]
        assert "!startsWith(github.head_ref, 'oncall/')" in condition
        assert self.text.count("gh pr merge") == 1

    def test_piped_script_failures_fail_the_step(self):
        # Actions의 기본 셸은 pipefail 없는 bash -e다. tee로 이으면 스크립트가 실패해도 단계가 성공한다.
        piped = [step for step in steps(self.oncall_job) + steps(self.publish_job) if "scripts/oncall.py" in step and "| tee" in step]
        assert len(piped) == 2
        for step in piped:
            assert "        shell: bash\n" in step


# ---------------------------------------------------------------------------
# oncall job의 Handoff 스텝 — npm은 가짜로 대체해 임시 저장소에서 스크립트를 실제로 실행한다
# ---------------------------------------------------------------------------

def git(root, *args):
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def write(root, rel, text):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


@pytest.fixture
def repo(tmp_path):
    """.oncall/을 무시하고 커밋이 하나 있는 임시 저장소."""
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "test")
    git(root, "config", "commit.gpgsign", "false")
    write(root, ".gitignore", ".oncall/\n")
    write(root, "src/total.ts", "export const total = 1\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    return root


def run_handoff_step(repo, tmp_path, npm_passes=True):
    """Handoff 스텝을 실행해 (종료 코드, 넘길 폴더, GITHUB_OUTPUT에 쓴 내용)을 돌려준다."""
    (step,) = [s for s in steps(job_text("oncall")) if s.startswith("name: Handoff")]
    script = textwrap.dedent(step.split("        run: |\n", 1)[1])

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    fake_npm = fake_bin / "npm"
    fake_npm.write_text(f"#!/bin/sh\nexit {0 if npm_passes else 1}\n")
    fake_npm.chmod(0o755)
    runner_temp = tmp_path / "runner"
    runner_temp.mkdir()
    output = tmp_path / "github_output"
    env = dict(
        os.environ,
        PATH=f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        RUNNER_TEMP=str(runner_temp), GITHUB_OUTPUT=str(output),
    )
    r = subprocess.run(["bash", "-e", "-c", script], cwd=repo, capture_output=True, text=True, env=env)
    return r.returncode, runner_temp / "oncall", output.read_text(encoding="utf-8") if output.exists() else ""


class TestHandoffStep:
    def agent_leaves_a_fix(self, repo):
        write(repo, "src/total.ts", "export const total = 2\n")
        write(repo, "src/total.test.ts", "test('total', () => {})\n")
        write(repo, ".oncall/failed.log", "FAIL src/total.test.ts\n")
        write(repo, ".oncall/report.md", "## 원인\n")

    def test_verified_fix_is_handed_off_as_a_patch(self, repo, tmp_path):
        self.agent_leaves_a_fix(repo)
        code, folder, output = run_handoff_step(repo, tmp_path)
        assert code == 0
        patch_text = (folder / "fix.patch").read_text(encoding="utf-8")
        assert "b/src/total.ts" in patch_text and "b/src/total.test.ts" in patch_text
        assert ".oncall" not in patch_text
        assert (folder / "report.md").read_text(encoding="utf-8") == "## 원인\n"
        assert output == "handoff=true\n"

    def test_work_folder_stays_out_of_the_patch_even_when_not_ignored(self, repo, tmp_path):
        write(repo, ".gitignore", "")
        git(repo, "commit", "-q", "-am", "ignore 규칙 없음")
        self.agent_leaves_a_fix(repo)
        code, folder, _ = run_handoff_step(repo, tmp_path)
        assert code == 0
        patch_text = (folder / "fix.patch").read_text(encoding="utf-8")
        assert "b/src/total.ts" in patch_text
        assert ".oncall" not in patch_text and "FAIL src/total.test.ts" not in patch_text

    def test_fix_that_fails_verification_is_not_handed_off(self, repo, tmp_path):
        self.agent_leaves_a_fix(repo)
        code, folder, output = run_handoff_step(repo, tmp_path, npm_passes=False)
        assert code == 0
        assert not (folder / "fix.patch").exists()
        assert (folder / "report.md").exists()
        assert output == "handoff=true\n"

    def test_report_without_changes_is_handed_off_alone(self, repo, tmp_path):
        write(repo, ".oncall/report.md", "## 고치지 않음\n")
        code, folder, output = run_handoff_step(repo, tmp_path)
        assert code == 0
        assert not (folder / "fix.patch").exists()
        assert output == "handoff=true\n"

    def test_agent_that_left_nothing_fails_the_job(self, repo, tmp_path):
        # 끝까지 돈 에이전트는 고치지 않았더라도 보고서를 남긴다. 아무것도 없으면 on-call 자체가 고장 난 것이다.
        code, _, output = run_handoff_step(repo, tmp_path)
        assert code != 0
        assert output == ""

    def test_patch_applies_to_a_fresh_checkout(self, repo, tmp_path):
        # oncall-publish는 에이전트가 건드린 폴더가 아니라 새 체크아웃에 패치를 얹는다.
        self.agent_leaves_a_fix(repo)
        _, folder, _ = run_handoff_step(repo, tmp_path)
        fresh = tmp_path / "fresh"
        subprocess.run(["git", "clone", "-q", str(repo), str(fresh)], check=True, capture_output=True)
        git(fresh, "apply", "--index", str(folder / "fix.patch"))
        assert (fresh / "src/total.ts").read_text(encoding="utf-8") == "export const total = 2\n"
        assert (fresh / "src/total.test.ts").exists()
