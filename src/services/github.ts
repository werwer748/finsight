// 서버 전용 래퍼. 클라이언트 컴포넌트에서는 import하지 않는다.
import type { OncallAlert } from "@/types/oncall";

// .github/workflows/의 파일 이름. scripts/test_oncall_alert.py가 둘이 같은지 본다.
export const ONCALL_WORKFLOW = "oncall-alert.yml";
const DISPATCH_TIMEOUT_MS = 10_000;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

// GitHub가 거절한 dispatch. 401(토큰 값), 403(권한), 404(저장소 접근)는 고칠 곳이 달라 웹훅이 status를 로그에 적는다.
export class OncallDispatchError extends Error {
  readonly status: number;

  constructor(status: number) {
    // 응답 본문에는 요청 정보가 섞일 수 있어 상태 코드만 남긴다.
    super(`on-call 워크플로우를 깨우지 못했어요. HTTP 상태: ${status}`);
    this.name = "OncallDispatchError";
    this.status = status;
  }
}

// on-call 워크플로우를 깨운다. 노이즈인지 신호인지는 CI의 헤드리스 에이전트가 판정한다.
export async function dispatchOncallAlert(alert: OncallAlert): Promise<void> {
  const token = process.env.ONCALL_GITHUB_TOKEN;
  const repository = process.env.ONCALL_GITHUB_REPOSITORY;

  if (!token || !repository) {
    const missing = [
      !token && "ONCALL_GITHUB_TOKEN",
      !repository && "ONCALL_GITHUB_REPOSITORY",
    ].filter(Boolean);
    throw new Error(`GitHub 환경변수가 설정되지 않았습니다: ${missing.join(", ")}`);
  }
  if (!REPOSITORY.test(repository)) {
    throw new Error("ONCALL_GITHUB_REPOSITORY는 owner/name 모양이어야 합니다.");
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${ONCALL_WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // workflow_dispatch는 기본 브랜치에 있는 워크플로우 파일로만 돈다.
      body: JSON.stringify({
        ref: "main",
        inputs: { event_id: alert.eventId, kind: alert.kind, issue_id: alert.issueId },
      }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new OncallDispatchError(response.status);
}
