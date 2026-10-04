"""
tdd_guard.py 테스트.
구현 파일을 고치기 전에 대응 테스트가 먼저 변경되었는지 판정하는 로직을 검증한다.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import tdd_guard as guard

SCRIPT = Path(__file__).parent / "tdd_guard.py"


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

def git(root, *args):
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def write(root, rel, text="x"):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    return p


def commit_all(root):
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "wip")


@pytest.fixture
def project(tmp_path):
    """git repo로 초기화된 임시 프로젝트."""
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "test@example.com")
    git(tmp_path, "config", "user.name", "test")
    git(tmp_path, "config", "commit.gpgsign", "false")
    return tmp_path


# ---------------------------------------------------------------------------
# check()
# ---------------------------------------------------------------------------

class TestCheck:
    def test_blocks_when_no_test_file(self, project):
        msg = guard.check(str(project / "src/lib/foo.ts"), project)
        assert msg is not None
        assert "src/lib/foo.test.ts" in msg

    def test_suggests_tsx_test_for_tsx_file(self, project):
        msg = guard.check(str(project / "src/components/Button.tsx"), project)
        assert "src/components/Button.test.tsx" in msg

    def test_allows_when_test_is_new(self, project):
        write(project, "src/lib/foo.test.ts")
        assert guard.check(str(project / "src/lib/foo.ts"), project) is None

    def test_allows_when_test_is_staged(self, project):
        write(project, "src/lib/foo.test.ts")
        git(project, "add", "-A")
        assert guard.check(str(project / "src/lib/foo.ts"), project) is None

    def test_blocks_when_test_unchanged_since_commit(self, project):
        write(project, "src/lib/foo.ts")
        write(project, "src/lib/foo.test.ts")
        commit_all(project)
        msg = guard.check(str(project / "src/lib/foo.ts"), project)
        assert msg is not None
        assert "src/lib/foo.test.ts" in msg

    def test_allows_when_test_modified_after_commit(self, project):
        write(project, "src/lib/foo.ts")
        test_file = write(project, "src/lib/foo.test.ts")
        commit_all(project)
        test_file.write_text("new case")
        assert guard.check(str(project / "src/lib/foo.ts"), project) is None

    def test_tsx_test_covers_tsx_component(self, project):
        write(project, "src/components/Button.test.tsx")
        assert guard.check(str(project / "src/components/Button.tsx"), project) is None

    def test_allows_test_file_itself(self, project):
        assert guard.check(str(project / "src/lib/foo.test.ts"), project) is None

    @pytest.mark.parametrize("rel", [
        "src/types/user.ts",
        "src/app/page.tsx",
        "README.md",
        "src/lib/data.json",
        "src/lib/env.d.ts",
    ])
    def test_allows_unguarded_files(self, project, rel):
        assert guard.check(str(project / rel), project) is None

    def test_guards_api_routes_and_services(self, project):
        assert guard.check(str(project / "src/app/api/users/route.ts"), project) is not None
        assert guard.check(str(project / "src/services/stock.ts"), project) is not None

    def test_allows_file_outside_project(self, project, tmp_path_factory):
        other = tmp_path_factory.mktemp("other")
        assert guard.check(str(other / "src/lib/foo.ts"), project) is None

    def test_without_git_only_checks_existence(self, tmp_path):
        assert guard.check(str(tmp_path / "src/lib/foo.ts"), tmp_path) is not None
        write(tmp_path, "src/lib/foo.test.ts")
        assert guard.check(str(tmp_path / "src/lib/foo.ts"), tmp_path) is None


# ---------------------------------------------------------------------------
# main() — 훅으로 실행될 때의 입출력
# ---------------------------------------------------------------------------

def run_hook(payload, project_dir=None):
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_PROJECT_DIR"}
    if project_dir:
        env["CLAUDE_PROJECT_DIR"] = str(project_dir)
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload), capture_output=True, text=True, env=env,
    )


class TestMain:
    def test_blocked_edit_exits_2_with_message(self, project):
        payload = {"tool_name": "Write", "tool_input": {"file_path": str(project / "src/lib/foo.ts")}}
        r = run_hook(payload, project_dir=project)
        assert r.returncode == 2
        assert "TDD GUARD" in r.stderr

    def test_allowed_edit_exits_0(self, project):
        write(project, "src/lib/foo.test.ts")
        payload = {"tool_name": "Edit", "tool_input": {"file_path": str(project / "src/lib/foo.ts")}}
        r = run_hook(payload, project_dir=project)
        assert r.returncode == 0
        assert r.stderr == ""

    def test_falls_back_to_payload_cwd(self, project):
        payload = {
            "tool_name": "Write",
            "tool_input": {"file_path": str(project / "src/lib/foo.ts")},
            "cwd": str(project),
        }
        assert run_hook(payload).returncode == 2
