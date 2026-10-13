#!/usr/bin/env python3
"""
On-call alert — prod 오류 alert를 판정하는 /oncall alert 스킬의 앞뒤 단계.

prepare는 에이전트를 띄우기 전에 실행한다. 이미 올린 alert인지 저장소(GitHub Issue)에서 먼저 확인하고,
PostHog에서 그 이슈의 통계와 표본을 받아 개인정보와 시크릿을 가린 뒤 .oncall/alert.json에 둔다.
publish는 에이전트가 끝난 뒤 다른 job에서 실행한다. 에이전트가 넘긴 판정과 보고서를 데이터로만 다룬다.
노이즈면 실행 요약에 기록만 남기고, 신호면 Issue를 열거나 이미 열려 있는 Issue에 댓글을 단다.

예외 메시지와 스택은 누구나 PostHog에 보낼 수 있는 글이다. 그 글을 읽은 에이전트가 내놓은 것은 믿지 않고 publish에서 검사한다.
저장소가 공개라 Issue와 실행 요약은 누구나 본다. 코드와 prod는 건드리지 않는다.
stdout에는 job summary로 나갈 글만, stderr에는 진단만 쓴다.

Usage:
    python3 scripts/oncall_alert.py prepare --event-id <id> --kind created|reopened|spiking --issue-id <uuid> [--output <파일>]
    python3 scripts/oncall_alert.py publish <폴더> --event-id <id> --kind <종류> --issue-id <uuid>
                                            --repo <owner/name> --run-id <id> [--assignee <login>]
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import List, Optional

from oncall import ANSI, API, CONTROL, WORKDIR, OncallError, redact, _read, _run, _write_output

KINDS = {"created": "새 오류", "reopened": "다시 발생한 오류", "spiking": "오류 급증"}
CONFIDENCE = {"high": "높음", "medium": "중간", "low": "낮음"}
LABEL = "oncall"
ISSUE_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
EVENT_STAMP = re.compile(r"[0-9a-f]{16}")
NO_VERDICT = "에이전트가 판정을 남기지 않아 신호로 올립니다."

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# 숫자가 4개 이상 든 숫자·쉼표·하이픈 구간. 계좌·카드번호와 금액이 여기에 걸린다.
DIGITS = re.compile(r"\d(?:[,-]?\d){3,}")
URL_QUERY = re.compile(r"""((?:https?://|/)[^\s?"'<>]*)\?[^\s"'<>)]+""")
MENTION = re.compile(r"@(?=\w)")
MESSAGE_LIMIT = 500
REPORT_LIMIT = 20_000
REASON_LIMIT = 200
MAX_FRAMES = 30
SAMPLES = 3
# PostHog의 504 한 번에 자료 없이 판정해 노이즈가 Issue로 올라간 적이 있다. 다시 보내기 전에 기다리는 초.
POSTHOG_RETRY_WAITS = (2, 5)

# 쿼리에 넣는 값은 check_ids를 통과한 이슈 id뿐이다. events를 읽는 쿼리는 모두 기간을 건다.
EXCEPTIONS = "FROM events WHERE event = '$exception' AND issue_id = '{issue_id}' AND timestamp >= now() - INTERVAL {days} DAY"
ISSUE_QUERY = "SELECT name, description, status, created_at FROM system.error_tracking_issues WHERE id = '{issue_id}' LIMIT 1"
STATS_QUERY = (
    "SELECT count() AS occurrences, uniq(person_id) AS users, uniq(nullIf($session_id, '')) AS sessions,"
    " min(timestamp) AS first_seen, max(timestamp) AS last_seen,"
    " countIf(timestamp >= now() - INTERVAL 1 HOUR) AS occurrences_1h,"
    " uniqIf(person_id, timestamp >= now() - INTERVAL 1 HOUR) AS users_1h,"
    " countIf(timestamp >= now() - INTERVAL 1 DAY) AS occurrences_24h,"
    " uniqIf(person_id, timestamp >= now() - INTERVAL 1 DAY) AS users_24h,"
    " countIf(properties.$virt_is_bot = true) AS bot_occurrences,"
    " countIf(properties.$exception_handled = true) AS handled_occurrences "
) + EXCEPTIONS
TIMELINE_QUERY = (
    "SELECT toStartOfHour(timestamp) AS hour, count() AS occurrences, uniq(person_id) AS users "
    + EXCEPTIONS + " GROUP BY hour ORDER BY hour"
)
BREAKDOWN_QUERY = (
    "SELECT toString(properties.{prop}) AS value, count() AS occurrences, uniq(person_id) AS users "
    + EXCEPTIONS + " GROUP BY value ORDER BY occurrences DESC LIMIT 5"
)
BREAKDOWNS = {"path": "$pathname", "host": "$host", "library": "$lib", "browser": "$browser", "traffic": "$virt_traffic_type"}
SAMPLE_QUERY = (
    "SELECT timestamp, properties.$pathname AS path, properties.$lib AS library, properties.$browser AS browser,"
    " properties.$exception_handled AS handled, properties.$virt_is_bot AS is_bot,"
    " properties.$exception_list AS exception_list "
    + EXCEPTIONS + f" ORDER BY timestamp DESC LIMIT {SAMPLES}"
)


def check_ids(event_id: str, kind: str, issue_id: str) -> None:
    """웹훅이 만든 모양이 아니면 던진다. 이 값들은 쿼리, jq 필터, Issue 본문에 그대로 들어간다."""
    if not ISSUE_ID.fullmatch(issue_id):
        raise OncallError("issue-id가 UUID가 아닙니다.")
    prefix = f"{kind}:{issue_id}:"
    if not event_id.startswith(prefix) or not EVENT_STAMP.fullmatch(event_id[len(prefix):]):
        raise OncallError("event-id가 종류:이슈 id:시각 해시 모양이 아닙니다.")


def issue_marker(issue_id: str) -> str:
    return f"<!-- oncall-issue:{issue_id} -->"


def event_marker(event_id: str) -> str:
    return f"<!-- oncall-event:{event_id} -->"


def scrub(text: object) -> str:
    """에이전트에게 주기 전에 PostHog에서 온 글의 시크릿, URL 쿼리, 이메일, 긴 숫자를 가린다."""
    text = URL_QUERY.sub(r"\1?[쿼리]", redact(str(text)))
    return DIGITS.sub("[숫자]", EMAIL.sub("[이메일]", text))[:MESSAGE_LIMIT]


def publicize(text: str) -> str:
    """에이전트가 쓴 글을 공개해도 되게 다듬는다. 건수와 파일:줄은 남겨야 하므로 숫자는 가리지 않는다."""
    text = EMAIL.sub("[이메일]", redact(CONTROL.sub("", ANSI.sub("", text))))
    # 표식은 HTML 주석이다. 에이전트의 글에 실리면 find_escalation과 is_handled가 속으므로 주석이 되지 못하게 한다.
    text = text.replace("<!--", "&lt;!--")
    # 멘션은 알림을 보낸다. @ 뒤에 폭 없는 공백을 넣어 글자는 남기고 알림만 끊는다.
    return MENTION.sub("@​", text)[:REPORT_LIMIT]


def find_escalation(issue_id: str) -> Optional[dict]:
    """이 PostHog 이슈로 열려 있는 에스컬레이션 Issue. 없으면 None이다."""
    # 라벨은 저장소에 쓰기 권한이 있어야 붙일 수 있다. 본문의 표식만 보면 남이 연 Issue가 걸린다.
    query = (f'.[] | select(.pull_request | not) | select((.body // "") | contains("{issue_marker(issue_id)}"))'
             " | {number, url: .html_url, body}")
    out = _run(["gh", "api", "--paginate", f"{API}/issues?state=open&labels={LABEL}&per_page=100", "--jq", query])
    found = [json.loads(line) for line in out.splitlines() if line.strip()]
    return found[0] if found else None


def is_handled(escalation: dict, event_id: str) -> bool:
    """이 alert를 그 Issue의 본문이나 댓글에 이미 올렸는지 본다."""
    marker = event_marker(event_id)
    if marker in (escalation.get("body") or ""):
        return True
    query = f'.[] | select((.body // "") | contains("{marker}")) | .id'
    path = f"{API}/issues/{escalation['number']}/comments?per_page=100"
    return bool(_run(["gh", "api", "--paginate", path, "--jq", query]).strip())


def _passing(error: Exception) -> bool:
    """다시 보내면 될 수 있는 실패인지 본다. 429를 뺀 4xx는 키나 쿼리가 틀린 것이라 다시 보내도 같다."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code >= 500 or error.code == 429
    return isinstance(error, OSError)


def _posthog(sql: str) -> List[dict]:
    """HogQL 쿼리 하나를 실행해 행을 {열: 값}으로 돌려준다. 지나가는 실패는 두 번까지 다시 보낸다."""
    names = ("POSTHOG_HOST", "POSTHOG_PROJECT_ID", "POSTHOG_PERSONAL_API_KEY")
    host, project, key = (os.environ.get(name, "") for name in names)
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise OncallError(f"PostHog 환경변수가 없습니다: {', '.join(missing)}")
    request = urllib.request.Request(
        f"{host.rstrip('/')}/api/projects/{project}/query/",
        data=json.dumps({"query": {"kind": "HogQLQuery", "query": sql}, "name": "oncall alert"}).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    waits = list(POSTHOG_RETRY_WAITS)
    while True:
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.load(response)
            return [dict(zip(data["columns"], row)) for row in data["results"]]
        except (OSError, ValueError, KeyError, TypeError) as e:
            if not waits or not _passing(e):
                raise OncallError(f"PostHog 조회 실패: {redact(str(e))}")
            time.sleep(waits.pop(0))


def _text(value: object) -> Optional[str]:
    return None if value is None else scrub(value)


def _code(value: object) -> Optional[str]:
    """파일 경로와 함수 이름. 긴 숫자를 가리면 에이전트가 파일을 찾지 못하므로 시크릿만 가린다."""
    return None if value is None else redact(str(value))[:MESSAGE_LIMIT]


def _sample(row: dict) -> dict:
    """예외 하나에서 에이전트가 볼 것만 남긴다. 프레임의 원본 경로에는 빌드한 기기의 경로가 들어 있어 버린다."""
    raw = row.get("exception_list")
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        parsed = None
    exceptions = []
    for item in parsed if isinstance(parsed, list) else []:
        if not isinstance(item, dict):
            continue
        frames = (item.get("stacktrace") or {}).get("frames") or []
        exceptions.append({
            "type": _text(item.get("type")),
            "value": _text(item.get("value")),
            # 던진 곳이 목록의 끝에 있다.
            "frames": [{
                "source": _code(frame.get("source")),
                "function": _code(frame.get("resolved_name") or frame.get("mangled_name")),
                "line": frame.get("line"),
                "column": frame.get("column"),
                "in_app": bool(frame.get("in_app")),
            } for frame in frames[-MAX_FRAMES:] if isinstance(frame, dict)],
        })
    return {
        "timestamp": row.get("timestamp"), "path": _text(row.get("path")), "library": _text(row.get("library")),
        "browser": _text(row.get("browser")), "handled": row.get("handled"), "is_bot": row.get("is_bot"),
        "exceptions": exceptions,
    }


def collect(issue_id: str) -> dict:
    """PostHog에서 이슈 하나의 자료를 모은다. 숫자는 전부 여기서 쿼리로 계산하고 에이전트는 옮겨 적기만 한다."""
    issue = _posthog(ISSUE_QUERY.format(issue_id=issue_id))
    stats = _posthog(STATS_QUERY.format(issue_id=issue_id, days=30))
    return {
        # 이름과 설명은 예외 메시지에서 온다.
        "issue": dict(issue[0], name=_text(issue[0].get("name")), description=_text(issue[0].get("description"))) if issue else None,
        "stats": stats[0] if stats else None,
        "timeline": _posthog(TIMELINE_QUERY.format(issue_id=issue_id, days=2)),
        "breakdowns": {
            name: [dict(row, value=_text(row.get("value"))) for row in
                   _posthog(BREAKDOWN_QUERY.format(prop=prop, issue_id=issue_id, days=7))]
            for name, prop in BREAKDOWNS.items()
        },
        "samples": [_sample(row) for row in _posthog(SAMPLE_QUERY.format(issue_id=issue_id, days=30))],
    }


def cmd_prepare(args: argparse.Namespace) -> int:
    check_ids(args.event_id, args.kind, args.issue_id)
    # 저장소를 먼저 본다. 이미 올린 alert면 PostHog도 에이전트도 부르지 않는다.
    escalation = find_escalation(args.issue_id)
    if escalation and is_handled(escalation, args.event_id):
        _write_output(args.output, ready="false")
        print(f"on-call: 이미 올린 alert라 건너뜁니다 — {escalation['url']}")
        return 0

    try:
        posthog, error = collect(args.issue_id), None
    except OncallError as e:
        # 자료가 없어도 에이전트에게 넘긴다. 여기서 멈추면 alert가 사라진다.
        posthog, error = None, str(e)
        print(f"ON-CALL: {e}", file=sys.stderr)

    WORKDIR.mkdir(exist_ok=True)
    (WORKDIR / "alert.json").write_text(json.dumps({
        "event_id": args.event_id, "kind": args.kind, "issue_id": args.issue_id,
        "open_escalation": escalation["number"] if escalation else None,
        "posthog": posthog, "posthog_error": error,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _write_output(args.output, ready="true")
    note = " PostHog 자료는 받지 못했습니다." if error else ""
    print(f"on-call: {KINDS[args.kind]} alert의 자료를 {WORKDIR / 'alert.json'}에 준비했습니다.{note}")
    return 0


def read_verdict(folder: Path) -> dict:
    """에이전트의 판정. 읽을 수 없으면 신호(확신도 낮음)로 본다."""
    try:
        data = json.loads(_read(folder / "verdict.json"))
    except ValueError:
        data = None
    if not isinstance(data, dict) or data.get("verdict") not in ("noise", "signal") or data.get("confidence") not in CONFIDENCE:
        return {"verdict": "signal", "confidence": "low", "reason": NO_VERDICT}
    reason = " ".join(publicize(str(data.get("reason") or "")).split())[:REASON_LIMIT]
    # 경계에서는 신호로 기운다. 확신 없는 노이즈 판정은 사람이 본다.
    verdict = "signal" if data["confidence"] == "low" else data["verdict"]
    return {"verdict": verdict, "confidence": data["confidence"], "reason": reason or "사유를 남기지 않았습니다."}


def _footer(args: argparse.Namespace) -> str:
    host, project = os.environ.get("POSTHOG_HOST", "").rstrip("/"), os.environ.get("POSTHOG_PROJECT_ID")
    lines = ["---", f"on-call 에이전트가 PostHog alert({KINDS[args.kind]})를 판정해 올린 글입니다.", ""]
    if host and project:
        lines.append(f"- PostHog 이슈(로그인 필요): {host}/project/{project}/error_tracking/{args.issue_id}")
    lines += [
        f"- 판정 실행: https://github.com/{args.repo}/actions/runs/{args.run_id}",
        "- 이 에이전트는 코드와 prod를 고치지 않습니다. 조치는 사람이 합니다.",
        "- 이 Issue가 열려 있는 동안 같은 이슈의 alert는 새 Issue 대신 댓글로 달립니다.",
        "- 노이즈였다면 `.claude/skills/oncall/known-noise.md`에 적고 닫으세요.",
        "",
        "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
    ]
    return "\n".join(lines) + "\n"


def cmd_publish(args: argparse.Namespace) -> int:
    check_ids(args.event_id, args.kind, args.issue_id)
    folder = Path(args.folder)
    verdict = read_verdict(folder)
    report = publicize(_read(folder / "report.md")).strip() or "on-call 에이전트가 보고서를 남기지 않았습니다."
    label = "신호" if verdict["verdict"] == "signal" else "노이즈"
    headline = f"**판정: {label} · 확신도 {CONFIDENCE[verdict['confidence']]}** — {verdict['reason']}"
    print(f"### on-call alert: {KINDS[args.kind]}\n\n{headline}\n\n{report}")
    if verdict["verdict"] == "noise":
        print("\n**on-call: 노이즈로 판정해 기록만 남깁니다.**")
        return 0

    # 쓰기 전에 저장소를 다시 본다. 같은 실행을 다시 돌려도 두 번 올리지 않는다.
    escalation = find_escalation(args.issue_id)
    if escalation and is_handled(escalation, args.event_id):
        print(f"\n**on-call: 이미 올린 alert입니다 — {escalation['url']}**")
        return 0

    # 제목, 라벨, 담당자는 호출자가 넘긴 값으로만 만든다. 에이전트가 쓴 글은 가린 본문에만 들어간다.
    folder.mkdir(parents=True, exist_ok=True)
    body_file = folder / "body.md"
    if escalation:
        body_file.write_text(
            f"{event_marker(args.event_id)}\n**후속 alert: {KINDS[args.kind]}**\n\n{headline}\n\n{report}\n\n{_footer(args)}",
            encoding="utf-8")
        _run(["gh", "issue", "comment", str(escalation["number"]), "--body-file", str(body_file)])
        print(f"\n**on-call: 열려 있는 Issue에 댓글로 올렸습니다 — {escalation['url']}**")
        return 0

    body_file.write_text(
        f"{issue_marker(args.issue_id)}\n{event_marker(args.event_id)}\n{headline}\n\n{report}\n\n{_footer(args)}",
        encoding="utf-8")
    title = f"on-call: {KINDS[args.kind]} · PostHog 이슈 {args.issue_id[:8]}"
    if verdict["confidence"] == "low":
        title += " [확신도 낮음]"
    _run(["gh", "label", "create", LABEL, "--force", "--color", "B60205", "--description", "on-call 에이전트가 올린 prod 오류"])
    create = ["gh", "issue", "create", "--title", title, "--body-file", str(body_file), "--label", LABEL]
    if args.assignee:
        create += ["--assignee", args.assignee]
    url = _run(create).strip()
    print(f"\n**on-call: Issue를 열었습니다 — {url}**")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="On-call alert")
    commands = parser.add_subparsers(dest="command", required=True)

    ids = argparse.ArgumentParser(add_help=False)
    ids.add_argument("--event-id", required=True, help="웹훅이 만든 멱등 키")
    ids.add_argument("--kind", required=True, choices=sorted(KINDS))
    ids.add_argument("--issue-id", required=True, help="PostHog error tracking 이슈의 id")

    prepare = commands.add_parser("prepare", parents=[ids], help="저장소를 확인하고 PostHog 자료를 준비한다")
    prepare.add_argument("--output", metavar="파일", help="이 파일에 ready=<true|false>를 덧붙인다")
    prepare.set_defaults(func=cmd_prepare)

    publish = commands.add_parser("publish", parents=[ids], help="넘겨받은 판정과 보고서로 기록을 남기거나 Issue를 올린다")
    publish.add_argument("folder", help="verdict.json과 report.md가 든 폴더")
    publish.add_argument("--repo", required=True, help="owner/name")
    publish.add_argument("--run-id", type=int, required=True)
    publish.add_argument("--assignee", help="새 Issue를 맡길 GitHub 계정")
    publish.set_defaults(func=cmd_publish)

    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except OncallError as e:
        print(f"ON-CALL: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
