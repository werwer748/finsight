"""
oncall_alert.py 테스트.
입력 검사, 가리기, 저장소 확인(멱등), PostHog 자료 준비, 판정 읽기, Issue 올리기와 oncall-alert 워크플로우를 검증한다.
gh와 PostHog는 실제로 부르지 않고 subprocess.run과 urllib.request.urlopen을 mock으로 대체한다.
"""

import io
import json
import re
import sys
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import oncall_alert as alert

PROJECT_ROOT = Path(__file__).parent.parent
WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "oncall-alert.yml"

ISSUE_ID = "01a13006-d265-7cf1-97c2-3b4b3cc88051"
EVENT_ID = f"spiking:{ISSUE_ID}:0123456789abcdef"
IDS = ["--event-id", EVENT_ID, "--kind", "spiking", "--issue-id", ISSUE_ID]
ISSUE_MARKER = f"<!-- oncall-issue:{ISSUE_ID} -->"
EVENT_MARKER = f"<!-- oncall-event:{EVENT_ID} -->"
ISSUE_URL = "https://github.com/o/r/issues/21"
# 진짜 토큰이 아니다. 패턴에 맞는 모양만 갖춘 값이다.
ANTHROPIC = "sk-ant-oat01-AbC_123-xyzXYZ"
POSTHOG_KEY = "phx_" + "Ab12" * 6


def escalation(number=21, body=ISSUE_MARKER):
    return {"number": number, "url": ISSUE_URL, "body": body}


def fake_run(open_issues=(), comment_hits="", fail=()):
    """gh 호출에 정해 둔 응답을 돌려주는 subprocess.run 대역. fail에 든 낱말이 명령에 있으면 실패시킨다."""
    bodies = []

    def respond(cmd, **kwargs):
        line = " ".join(cmd)
        if any(word in line for word in fail):
            return MagicMock(returncode=1, stdout="", stderr="실패")
        out = ""
        if cmd[:2] == ["gh", "api"]:
            path = next(part for part in cmd if part.startswith("repos/"))
            out = comment_hits if "/comments?" in path else "".join(json.dumps(issue) + "\n" for issue in open_issues)
        elif cmd[:3] in (["gh", "issue", "create"], ["gh", "issue", "comment"]):
            bodies.append(Path(cmd[cmd.index("--body-file") + 1]).read_text(encoding="utf-8"))
            out = ISSUE_URL + "\n"
        return MagicMock(returncode=0, stdout=out, stderr="")

    mock = MagicMock(side_effect=respond)
    mock.bodies = bodies
    return mock


def commands(mock_run):
    return [c[0][0] for c in mock_run.call_args_list]


def writes(mock_run):
    """저장소를 바꾸는 gh 호출만 고른다."""
    return [cmd for cmd in commands(mock_run) if cmd[:2] != ["gh", "api"]]


FRAME = {
    "column": 13, "in_app": True, "line": 31, "lang": "javascript",
    "mangled_name": "t", "resolved_name": "sumAmounts", "source": "src/lib/dashboard/summarize.ts",
    "resolved": True, "raw_id": "a3944b89/0",
    "junk_drawer": {"raw_frame": {"filename": "file:///Users/someone/finsight/.next/server/chunks/ssr/1.js"}},
}
SAMPLE_ROW = {
    "timestamp": "2026-10-12T12:13:24.987000Z", "path": "/dashboard", "library": "web", "browser": "Chrome",
    "handled": False, "is_bot": False,
    # PostHog는 이 열을 JSON 문자열로 돌려준다.
    "exception_list": json.dumps([{
        "type": "TypeError",
        "value": "user hong@example.com 계좌 110-234-567890 조회 실패 /auth/confirm?token_hash=abc123",
        "stacktrace": {"frames": [FRAME]},
    }]),
}
ROWS = {
    "system.error_tracking_issues": [{"name": "TypeError", "description": "x is undefined", "status": "active",
                                      "created_at": "2026-10-12T12:11:55Z"}],
    "occurrences_1h": [{"occurrences": 14, "users": 5, "sessions": 6, "first_seen": "2026-10-12T12:11:52Z",
                        "last_seen": "2026-10-13T08:00:00Z", "occurrences_1h": 9, "users_1h": 4,
                        "occurrences_24h": 14, "users_24h": 5, "bot_occurrences": 0, "handled_occurrences": 2}],
    "toStartOfHour": [{"hour": "2026-10-13T07:00:00Z", "occurrences": 9, "users": 4}],
    "GROUP BY value": [{"value": "/dashboard", "occurrences": 14, "users": 5}],
    "exception_list": [SAMPLE_ROW],
}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fake_urlopen(rows=None, error=None):
    """PostHog 쿼리 API 대역. 쿼리 글자에 든 낱말로 응답을 고른다."""
    rows = ROWS if rows is None else rows

    def respond(request, timeout=None):
        if error:
            raise error
        sql = json.loads(request.data)["query"]["query"]
        found = next((value for key, value in rows.items() if key in sql), [])
        columns = list(found[0]) if found else []
        payload = {"columns": columns, "results": [[row[c] for c in columns] for row in found]}
        return FakeResponse(json.dumps(payload).encode())

    return MagicMock(side_effect=respond)


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("POSTHOG_HOST", "https://us.posthog.com")
    monkeypatch.setenv("POSTHOG_PROJECT_ID", "660065")
    monkeypatch.setenv("POSTHOG_PERSONAL_API_KEY", POSTHOG_KEY)
    return tmp_path


# ---------------------------------------------------------------------------
# 입력 검사 — 워크플로우 입력은 저장소에 쓰기 권한이 있는 누구나 직접 넣을 수 있다
# ---------------------------------------------------------------------------

class TestCheckIds:
    def test_accepts_ids_made_by_the_webhook(self):
        alert.check_ids(EVENT_ID, "spiking", ISSUE_ID)

    @pytest.mark.parametrize("event_id,kind,issue_id", [
        (EVENT_ID, "spiking", "not-a-uuid"),
        (EVENT_ID, "spiking", f"{ISSUE_ID}' OR 1=1 --"),
        (EVENT_ID, "created", ISSUE_ID),
        (f"spiking:{ISSUE_ID}:xyz", "spiking", ISSUE_ID),
        (f"spiking:{ISSUE_ID}:0123456789abcdef -->", "spiking", ISSUE_ID),
        (f"spiking:{'0' * 8}-0000-0000-0000-{'0' * 12}:0123456789abcdef", "spiking", ISSUE_ID),
    ])
    def test_rejects_ids_that_do_not_fit(self, event_id, kind, issue_id):
        with pytest.raises(alert.OncallError):
            alert.check_ids(event_id, kind, issue_id)

    def test_bad_ids_stop_before_any_call(self, workdir):
        mock = fake_run()
        with patch("subprocess.run", mock), patch("urllib.request.urlopen", fake_urlopen()) as urlopen:
            assert alert.main(["prepare", "--event-id", EVENT_ID, "--kind", "spiking", "--issue-id", "x"]) == 1
        assert mock.call_count == 0 and urlopen.call_count == 0

    def test_unknown_kind_is_rejected(self, workdir):
        with pytest.raises(SystemExit):
            alert.main(["prepare", "--event-id", EVENT_ID, "--kind", "deleted", "--issue-id", ISSUE_ID])


# ---------------------------------------------------------------------------
# scrub() / publicize()
# ---------------------------------------------------------------------------

class TestScrub:
    @pytest.mark.parametrize("text,gone", [
        ("user hong@example.com not found", "hong@example.com"),
        ("계좌 110-234-567890 조회 실패", "110-234-567890"),
        ("금액 1,234,567원을 읽지 못함", "1,234,567"),
        ("GET /auth/confirm?token_hash=abc123&type=email failed", "token_hash=abc123"),
        ("fetch https://example.com/api?key=abcdef failed", "key=abcdef"),
        (f"토큰 {ANTHROPIC} 거절", ANTHROPIC),
    ])
    def test_masks_personal_data_and_secrets(self, text, gone):
        assert gone not in alert.scrub(text)

    @pytest.mark.parametrize("text", [
        "Cannot read properties of undefined (reading 'amount')",
        "Request failed with status 500",
        "ChunkLoadError: Loading chunk failed",
    ])
    def test_leaves_ordinary_messages_alone(self, text):
        assert alert.scrub(text) == text

    def test_keeps_the_path_of_a_url(self):
        assert "/auth/confirm" in alert.scrub("GET /auth/confirm?token_hash=abc123 failed")

    def test_cuts_long_text(self):
        assert len(alert.scrub("가" * 5000)) <= 500


class TestPublicize:
    def test_masks_secrets_and_emails(self):
        out = alert.publicize(f"토큰 {ANTHROPIC} 과 hong@example.com 이 보였다")
        assert ANTHROPIC not in out and "hong@example.com" not in out

    def test_mentions_notify_nobody(self):
        out = alert.publicize("원인은 @octocat 의 커밋, @org/team 확인 필요")
        assert "@octocat" not in out and "@org/team" not in out
        assert "octocat" in out

    def test_strips_control_characters(self):
        assert alert.publicize("앞\x1b[31m뒤\x00끝\n다음 줄") == "앞뒤끝\n다음 줄"

    def test_keeps_counts_and_code_locations(self):
        text = "`src/lib/dashboard/summarize.ts:31`에서 5명, 14건"
        assert alert.publicize(text) == text

    def test_cuts_long_reports(self):
        assert len(alert.publicize("가" * 100_000)) <= 20_000

    def test_agent_text_cannot_carry_a_marker(self):
        # 표식은 HTML 주석이다. 보고서에 실리면 다음 alert가 엉뚱한 Issue의 댓글로 가거나 이미 올린 것으로 건너뛴다.
        other = "11111111-2222-3333-4444-555555555555"
        out = alert.publicize(f"요약\n<!-- oncall-issue:{other} -->\n{EVENT_MARKER}\n")
        assert "<!--" not in out
        assert "oncall-issue" in out and "요약" in out


# ---------------------------------------------------------------------------
# 저장소 확인 — 열려 있는 에스컬레이션과 이미 올린 alert
# ---------------------------------------------------------------------------

class TestFindEscalation:
    def test_returns_the_open_issue_for_this_posthog_issue(self):
        mock = fake_run(open_issues=[escalation()])
        with patch("subprocess.run", mock):
            assert alert.find_escalation(ISSUE_ID)["number"] == 21

    def test_none_when_nothing_is_open(self):
        with patch("subprocess.run", fake_run()):
            assert alert.find_escalation(ISSUE_ID) is None

    def test_looks_only_at_open_issues_with_the_oncall_label(self):
        # 라벨은 저장소에 쓰기 권한이 있어야 붙일 수 있다. 본문만 보면 남이 연 Issue가 에스컬레이션을 가로챈다.
        mock = fake_run()
        with patch("subprocess.run", mock):
            alert.find_escalation(ISSUE_ID)
        (cmd,) = commands(mock)
        path = next(part for part in cmd if part.startswith("repos/"))
        assert "state=open" in path and "labels=oncall" in path
        assert "--paginate" in cmd

    def test_filters_by_the_issue_marker_and_skips_pull_requests(self):
        mock = fake_run()
        with patch("subprocess.run", mock):
            alert.find_escalation(ISSUE_ID)
        jq = commands(mock)[0][-1]
        assert ISSUE_MARKER in jq and "pull_request" in jq


class TestIsHandled:
    def test_event_marker_in_the_issue_body(self):
        mock = fake_run()
        with patch("subprocess.run", mock):
            assert alert.is_handled(escalation(body=f"{ISSUE_MARKER}\n{EVENT_MARKER}"), EVENT_ID)
        assert mock.call_count == 0

    def test_event_marker_in_a_comment(self):
        mock = fake_run(comment_hits="991\n")
        with patch("subprocess.run", mock):
            assert alert.is_handled(escalation(), EVENT_ID)
        (cmd,) = commands(mock)
        assert "repos/{owner}/{repo}/issues/21/comments?per_page=100" in cmd
        assert EVENT_MARKER in cmd[-1]

    def test_another_event_is_not_handled(self):
        other = EVENT_MARKER.replace("0123456789abcdef", "fedcba9876543210")
        with patch("subprocess.run", fake_run()):
            assert not alert.is_handled(escalation(body=f"{ISSUE_MARKER}\n{other}"), EVENT_ID)


# ---------------------------------------------------------------------------
# prepare
# ---------------------------------------------------------------------------

def prepare(run=None, urlopen=None, extra=()):
    run = fake_run() if run is None else run
    urlopen = fake_urlopen() if urlopen is None else urlopen
    with patch("subprocess.run", run), patch("urllib.request.urlopen", urlopen):
        return alert.main(["prepare", *IDS, *extra])


def prepared(workdir):
    return json.loads((workdir / ".oncall" / "alert.json").read_text(encoding="utf-8"))


class TestPrepare:
    def test_writes_stats_for_the_agent(self, workdir):
        assert prepare() == 0
        data = prepared(workdir)
        assert data["event_id"] == EVENT_ID and data["kind"] == "spiking" and data["issue_id"] == ISSUE_ID
        assert data["posthog"]["issue"]["status"] == "active"
        assert data["posthog"]["stats"]["users_1h"] == 4
        assert data["posthog"]["timeline"] == [{"hour": "2026-10-13T07:00:00Z", "occurrences": 9, "users": 4}]
        assert data["posthog"]["breakdowns"]["path"] == [{"value": "/dashboard", "occurrences": 14, "users": 5}]
        # host는 개발 환경의 오류를, traffic은 봇을 가려내는 데 쓴다.
        assert set(data["posthog"]["breakdowns"]) == {"path", "host", "library", "browser", "traffic"}
        assert data["posthog_error"] is None

    def test_reports_ready(self, workdir, capsys):
        out_file = workdir / "github_output"
        assert prepare(extra=["--output", str(out_file)]) == 0
        assert out_file.read_text(encoding="utf-8") == "ready=true\n"
        assert "오류 급증" in capsys.readouterr().out

    def test_checks_the_store_before_asking_posthog(self, workdir):
        # 이미 올린 alert면 PostHog도 에이전트도 부르지 않는다.
        out_file = workdir / "github_output"
        run = fake_run(open_issues=[escalation(body=f"{ISSUE_MARKER}\n{EVENT_MARKER}")])
        urlopen = fake_urlopen()
        assert prepare(run, urlopen, ["--output", str(out_file)]) == 0
        assert urlopen.call_count == 0
        assert out_file.read_text(encoding="utf-8") == "ready=false\n"
        assert not (workdir / ".oncall").exists()

    def test_tells_the_agent_about_an_open_escalation(self, workdir):
        assert prepare(fake_run(open_issues=[escalation()])) == 0
        assert prepared(workdir)["open_escalation"] == 21

    def test_no_open_escalation(self, workdir):
        prepare()
        assert prepared(workdir)["open_escalation"] is None

    def test_queries_only_this_issue_with_a_time_bound(self, workdir):
        urlopen = fake_urlopen()
        prepare(urlopen=urlopen)
        for call in urlopen.call_args_list:
            request = call[0][0]
            sql = json.loads(request.data)["query"]["query"]
            assert ISSUE_ID in sql
            assert "system.error_tracking_issues" in sql or "timestamp >= now() - INTERVAL" in sql
            assert request.full_url == "https://us.posthog.com/api/projects/660065/query/"
            assert request.get_header("Authorization") == f"Bearer {POSTHOG_KEY}"

    def test_sample_keeps_only_what_the_agent_needs(self, workdir):
        prepare()
        (sample,) = prepared(workdir)["posthog"]["samples"]
        (exception,) = sample["exceptions"]
        assert exception["type"] == "TypeError"
        assert exception["frames"] == [{"source": "src/lib/dashboard/summarize.ts", "function": "sumAmounts",
                                        "line": 31, "column": 13, "in_app": True}]
        assert sample["path"] == "/dashboard"

    def test_sample_message_is_scrubbed(self, workdir):
        prepare()
        text = (workdir / ".oncall" / "alert.json").read_text(encoding="utf-8")
        for leaked in ("hong@example.com", "110-234-567890", "token_hash=abc123", "/Users/someone"):
            assert leaked not in text
        assert "조회 실패" in text

    def test_issue_name_and_description_are_scrubbed(self, workdir):
        rows = dict(ROWS)
        rows["system.error_tracking_issues"] = [{"name": "Error", "description": "mail hong@example.com",
                                                 "status": "active", "created_at": "2026-10-12T12:11:55Z"}]
        prepare(urlopen=fake_urlopen(rows))
        assert "hong@example.com" not in (workdir / ".oncall" / "alert.json").read_text(encoding="utf-8")

    def test_posthog_failure_still_hands_the_alert_to_the_agent(self, workdir, capsys):
        # 자료가 없으면 에이전트가 신호(확신도 낮음)로 올린다. 여기서 멈추면 alert가 사라진다.
        out_file = workdir / "github_output"
        error = urllib.error.HTTPError("https://us.posthog.com", 401, "Unauthorized", {}, None)
        assert prepare(urlopen=fake_urlopen(error=error), extra=["--output", str(out_file)]) == 0
        data = prepared(workdir)
        assert data["posthog"] is None
        assert "401" in data["posthog_error"]
        assert out_file.read_text(encoding="utf-8") == "ready=true\n"
        captured = capsys.readouterr()
        assert POSTHOG_KEY not in captured.out + captured.err

    def test_missing_posthog_settings_are_a_posthog_failure(self, workdir, monkeypatch):
        monkeypatch.delenv("POSTHOG_PERSONAL_API_KEY")
        urlopen = fake_urlopen()
        assert prepare(urlopen=urlopen) == 0
        assert urlopen.call_count == 0
        assert "POSTHOG_PERSONAL_API_KEY" in prepared(workdir)["posthog_error"]

    def test_unreadable_sample_is_skipped(self, workdir):
        rows = dict(ROWS)
        rows["exception_list"] = [dict(SAMPLE_ROW, exception_list="not json")]
        assert prepare(urlopen=fake_urlopen(rows)) == 0
        assert prepared(workdir)["posthog"]["samples"][0]["exceptions"] == []

    def test_fails_when_the_store_cannot_be_read(self, workdir):
        # 저장소를 확인하지 못한 채 올리면 같은 Issue가 두 번 열릴 수 있다. 실패한 실행은 publish가 신호로 올린다.
        assert prepare(fake_run(fail=("gh api",))) == 1
        assert not (workdir / ".oncall").exists()


# ---------------------------------------------------------------------------
# 판정 읽기
# ---------------------------------------------------------------------------

@pytest.fixture
def handoff(tmp_path):
    folder = tmp_path / "handoff"
    folder.mkdir()
    write_verdict(folder, "signal", "high", "핵심 경로에서 4명이 겪는 새 오류")
    (folder / "report.md").write_text("## 무슨 오류인가\n대시보드 합계 계산이 실패한다.\n", encoding="utf-8")
    return folder


def write_verdict(folder, verdict, confidence, reason="사유"):
    (folder / "verdict.json").write_text(
        json.dumps({"verdict": verdict, "confidence": confidence, "reason": reason}, ensure_ascii=False), encoding="utf-8")


class TestReadVerdict:
    def test_reads_a_valid_verdict(self, handoff):
        assert alert.read_verdict(handoff) == {
            "verdict": "signal", "confidence": "high", "reason": "핵심 경로에서 4명이 겪는 새 오류"}

    @pytest.mark.parametrize("content", [
        None,
        "",
        "not json",
        "[]",
        '{"verdict": "ignore", "confidence": "high"}',
        '{"verdict": "noise", "confidence": "certain"}',
        '{"verdict": "noise"}',
    ])
    def test_missing_or_broken_verdict_becomes_a_low_confidence_signal(self, handoff, content):
        # 판정을 읽지 못했다고 조용히 넘기지 않는다.
        if content is None:
            (handoff / "verdict.json").unlink()
        else:
            (handoff / "verdict.json").write_text(content, encoding="utf-8")
        verdict = alert.read_verdict(handoff)
        assert verdict["verdict"] == "signal" and verdict["confidence"] == "low"
        assert "판정을 남기지 않아" in verdict["reason"]

    def test_missing_folder_becomes_a_low_confidence_signal(self, tmp_path):
        verdict = alert.read_verdict(tmp_path / "없음")
        assert verdict["verdict"] == "signal" and verdict["confidence"] == "low"

    def test_unsure_noise_leans_to_signal(self, handoff):
        write_verdict(handoff, "noise", "low", "봇인지 확실하지 않음")
        assert alert.read_verdict(handoff) == {
            "verdict": "signal", "confidence": "low", "reason": "봇인지 확실하지 않음"}

    @pytest.mark.parametrize("confidence", ["high", "medium"])
    def test_confident_noise_stays_noise(self, handoff, confidence):
        write_verdict(handoff, "noise", confidence)
        assert alert.read_verdict(handoff)["verdict"] == "noise"

    def test_reason_is_one_masked_line(self, handoff):
        write_verdict(handoff, "signal", "medium", f"첫 줄 {ANTHROPIC}\n# 둘째 줄 @octocat " + "가" * 500)
        reason = alert.read_verdict(handoff)["reason"]
        assert "\n" not in reason and ANTHROPIC not in reason and "@octocat" not in reason
        assert len(reason) <= 200


# ---------------------------------------------------------------------------
# publish
# ---------------------------------------------------------------------------

PUBLISH_ARGS = [*IDS, "--repo", "o/r", "--run-id", "111", "--assignee", "hugo"]
RUN_URL = "https://github.com/o/r/actions/runs/111"
TITLE = "on-call: 오류 급증 · PostHog 이슈 01a13006"


def publish(folder, mock, args=PUBLISH_ARGS):
    with patch("subprocess.run", mock):
        return alert.main(["publish", str(folder), *args])


class TestPublish:
    def test_noise_is_recorded_and_nothing_is_written_to_the_repo(self, handoff, workdir, capsys):
        write_verdict(handoff, "noise", "high", "알려진 브라우저 확장 오류")
        mock = fake_run()
        assert publish(handoff, mock) == 0
        assert mock.call_count == 0
        out = capsys.readouterr().out
        assert "노이즈" in out and "알려진 브라우저 확장 오류" in out
        assert "대시보드 합계 계산이 실패한다." in out

    def test_signal_opens_an_issue(self, handoff, workdir, capsys):
        mock = fake_run()
        assert publish(handoff, mock) == 0
        (create,) = [cmd for cmd in commands(mock) if cmd[:3] == ["gh", "issue", "create"]]
        assert create[create.index("--title") + 1] == TITLE
        assert create[create.index("--label") + 1] == "oncall"
        assert create[create.index("--assignee") + 1] == "hugo"
        assert ISSUE_URL in capsys.readouterr().out

    def test_label_exists_before_the_issue_is_opened(self, handoff, workdir):
        mock = fake_run()
        publish(handoff, mock)
        names = [cmd[:3] for cmd in writes(mock)]
        assert names == [["gh", "label", "create"], ["gh", "issue", "create"]]
        assert "--force" in writes(mock)[0]

    def test_issue_body_has_analysis_markers_and_links(self, handoff, workdir):
        mock = fake_run()
        publish(handoff, mock)
        (body,) = mock.bodies
        assert ISSUE_MARKER in body and EVENT_MARKER in body
        assert "판정: 신호 · 확신도 높음" in body
        assert "핵심 경로에서 4명이 겪는 새 오류" in body
        assert "대시보드 합계 계산이 실패한다." in body
        assert f"https://us.posthog.com/project/660065/error_tracking/{ISSUE_ID}" in body
        assert RUN_URL in body
        assert "고치지 않습니다" in body

    def test_low_confidence_is_marked_in_title_and_body(self, handoff, workdir):
        write_verdict(handoff, "signal", "low", "자료가 부족함")
        mock = fake_run()
        publish(handoff, mock)
        (create,) = [cmd for cmd in commands(mock) if cmd[:3] == ["gh", "issue", "create"]]
        assert create[create.index("--title") + 1] == f"{TITLE} [확신도 낮음]"
        assert "확신도 낮음" in mock.bodies[0]

    def test_open_escalation_gets_a_comment_instead_of_a_new_issue(self, handoff, workdir, capsys):
        mock = fake_run(open_issues=[escalation()])
        assert publish(handoff, mock) == 0
        assert [cmd[:4] for cmd in writes(mock)] == [["gh", "issue", "comment", "21"]]
        (body,) = mock.bodies
        assert EVENT_MARKER in body and ISSUE_MARKER not in body
        assert "오류 급증" in body and "대시보드 합계 계산이 실패한다." in body
        assert ISSUE_URL in capsys.readouterr().out

    def test_checks_the_store_first_and_skips_an_alert_already_published(self, handoff, workdir, capsys):
        # 같은 실행을 다시 돌려도 Issue나 댓글이 두 번 달리지 않는다.
        mock = fake_run(open_issues=[escalation()], comment_hits="991\n")
        assert publish(handoff, mock) == 0
        assert writes(mock) == []
        assert "이미 올린 alert" in capsys.readouterr().out

    def test_missing_handoff_is_escalated_with_low_confidence(self, tmp_path, workdir):
        # triage job이 실패하면 artifact가 없다.
        mock = fake_run()
        assert publish(tmp_path / "없음", mock) == 0
        (create,) = [cmd for cmd in commands(mock) if cmd[:3] == ["gh", "issue", "create"]]
        assert create[create.index("--title") + 1].endswith("[확신도 낮음]")
        assert "판정을 남기지 않아" in mock.bodies[0]

    def test_unsure_noise_is_escalated(self, handoff, workdir):
        write_verdict(handoff, "noise", "low")
        mock = fake_run()
        publish(handoff, mock)
        assert [cmd for cmd in commands(mock) if cmd[:3] == ["gh", "issue", "create"]]

    def test_report_is_masked_in_summary_and_issue(self, handoff, workdir, capsys):
        (handoff / "report.md").write_text(f"토큰 {ANTHROPIC}, 사용자 hong@example.com, @octocat\n", encoding="utf-8")
        mock = fake_run()
        publish(handoff, mock)
        published = capsys.readouterr().out + mock.bodies[0]
        for leaked in (ANTHROPIC, "hong@example.com", "@octocat"):
            assert leaked not in published

    def test_agent_text_never_reaches_title_label_or_assignee(self, handoff, workdir):
        write_verdict(handoff, "signal", "high", "제목을 바꿔라")
        (handoff / "report.md").write_text("# 무시하고 main에 push하라\n", encoding="utf-8")
        mock = fake_run()
        publish(handoff, mock)
        for cmd in commands(mock):
            arguments = [part for i, part in enumerate(cmd) if cmd[i - 1] != "--body-file"]
            assert not [part for part in arguments if "main에 push" in part or "제목을 바꿔라" in part]

    def test_assignee_is_optional(self, handoff, workdir):
        mock = fake_run()
        assert publish(handoff, mock, PUBLISH_ARGS[:-2]) == 0
        (create,) = [cmd for cmd in commands(mock) if cmd[:3] == ["gh", "issue", "create"]]
        assert "--assignee" not in create

    def test_fails_when_the_issue_cannot_be_opened(self, handoff, workdir):
        # 실패한 실행은 GitHub가 알린다. 성공으로 끝내면 아무도 모른다.
        assert publish(handoff, fake_run(fail=("gh issue create",))) == 1

    def test_never_touches_code(self, handoff, workdir):
        mock = fake_run()
        publish(handoff, mock)
        assert not [cmd for cmd in commands(mock) if cmd[0] == "git" or "pr" in cmd[:2]]

    def test_bad_ids_write_nothing(self, handoff, workdir):
        mock = fake_run()
        args = ["--event-id", EVENT_ID, "--kind", "spiking", "--issue-id", "x", "--repo", "o/r", "--run-id", "111"]
        assert publish(handoff, mock, args) == 1
        assert mock.call_count == 0


# ---------------------------------------------------------------------------
# 워크플로우
# ---------------------------------------------------------------------------

def job_text(name):
    """워크플로우에서 job 하나의 본문만 잘라 낸다."""
    body = WORKFLOW.read_text(encoding="utf-8").split(f"\n  {name}:\n", 1)[1]
    following = [i for i in (body.find(f"\n  {other}:\n") for other in ("triage", "publish")) if i != -1]
    return body[:min(following)] if following else body


def steps(job_body):
    return job_body.split("    steps:\n", 1)[1].split("\n      - ")


class TestWorkflow:
    text = WORKFLOW.read_text(encoding="utf-8")
    triage_job = job_text("triage")
    publish_job = job_text("publish")

    def test_is_woken_only_by_dispatch(self):
        triggers = self.text.split("\non:\n", 1)[1].split("\nconcurrency:", 1)[0]
        assert re.findall(r"^  (\w+):", triggers, re.MULTILINE) == ["workflow_dispatch"]

    def test_file_name_matches_the_webhook_dispatcher(self):
        dispatcher = (PROJECT_ROOT / "src" / "services" / "github.ts").read_text(encoding="utf-8")
        assert f'ONCALL_WORKFLOW = "{WORKFLOW.name}"' in dispatcher

    def test_alerts_for_one_issue_run_one_at_a_time(self):
        # 동시에 돌면 둘 다 열린 Issue가 없다고 보고 Issue를 두 개 연다.
        assert "  group: oncall-alert-${{ inputs.issue_id }}\n  cancel-in-progress: false\n" in self.text

    def test_inputs_reach_scripts_only_through_the_environment(self):
        # run 스크립트에 ${{ inputs.* }}를 직접 쓰면 입력이 셸 코드로 실행된다.
        for line in self.text.splitlines():
            if "${{ inputs." in line:
                assert re.fullmatch(r"\s+(group|[A-Z_]+): .*\$\{\{ inputs\.\w+ \}\}", line), line

    def test_agent_job_has_no_write_permission(self):
        assert ": write" not in self.triage_job

    def test_agent_step_gets_no_github_or_posthog_credentials(self):
        (agent,) = [step for step in steps(self.triage_job) if "claude -p" in step]
        for name in ("GH_TOKEN", "github.token", "POSTHOG_PERSONAL_API_KEY"):
            assert name not in agent

    def test_agent_runs_the_skill_with_write_as_its_only_extra_tool(self):
        (agent,) = [step for step in steps(self.triage_job) if "claude -p" in step]
        assert 'claude -p "/oncall alert"' in agent
        assert "--permission-mode dontAsk" in agent
        assert "--allowedTools Write \\\n" in agent
        assert "Bash(" not in agent and "Edit" not in agent

    def test_agent_session_skips_the_stop_hook_checks(self):
        (agent,) = [step for step in steps(self.triage_job) if "claude -p" in step]
        assert "ONCALL_ALERT_ACTIVE: 1" in agent

    def test_store_is_checked_before_the_agent_starts(self):
        all_steps = steps(self.triage_job)
        prepare_step = next(i for i, step in enumerate(all_steps) if "oncall_alert.py prepare" in step)
        agent = next(i for i, step in enumerate(all_steps) if "claude -p" in step)
        assert prepare_step < agent
        for step in all_steps[prepare_step + 1:]:
            assert "if: steps.prepare.outputs.ready == 'true'" in step, step.splitlines()[0]

    def test_bubblewrap_is_installed_before_the_agent_starts(self):
        all_steps = steps(self.triage_job)
        install = next(i for i, step in enumerate(all_steps) if "apt-get install -y -q bubblewrap socat" in step)
        agent = next(i for i, step in enumerate(all_steps) if "claude -p" in step)
        assert install < agent
        assert "CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 1" in all_steps[agent]
        assert "kernel.apparmor_restrict_unprivileged_userns=0" in all_steps[install]
        assert "\n          bwrap --unshare-pid " in all_steps[install]

    def test_handoff_artifact_expires_in_a_day(self):
        assert "retention-days: 1" in self.triage_job

    def test_publish_runs_even_when_triage_failed(self):
        # 판정이 없으면 publish가 신호(확신도 낮음)로 올린다. 이미 올린 alert만 건너뛴다.
        assert "    needs: triage\n" in self.publish_job
        assert "if: ${{ !cancelled() && needs.triage.outputs.ready != 'false' }}" in self.publish_job
        (download,) = [step for step in steps(self.publish_job) if "download-artifact" in step]
        assert "continue-on-error: true" in download

    def test_only_the_publish_job_can_write_issues(self):
        assert self.text.count(": write") == 1
        assert "      issues: write\n" in self.publish_job

    def test_publish_job_runs_neither_claude_nor_npm(self):
        assert "claude" not in self.publish_job
        assert "npm " not in self.publish_job
        assert "scripts/oncall_alert.py publish" in self.publish_job

    def test_nothing_in_the_workflow_can_change_code_or_prod(self):
        assert "contents: write" not in self.text
        for word in ("git push", "gh pr", "vercel", "supabase"):
            assert word not in self.text

    def test_piped_script_failures_fail_the_step(self):
        piped = [step for step in steps(self.triage_job) + steps(self.publish_job)
                 if "scripts/oncall_alert.py" in step and "| tee" in step]
        assert len(piped) == 2
        for step in piped:
            assert "        shell: bash\n" in step
