import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { OncallAlert, OncallAlertKind } from "@/types/oncall";

const KINDS: Record<string, OncallAlertKind> = {
  $error_tracking_issue_created: "created",
  $error_tracking_issue_reopened: "reopened",
  $error_tracking_issue_spiking: "spiking",
};

// PostHog alert의 본문 템플릿이 보내는 필드. 이슈 이름과 설명처럼 누구나 쓸 수 있는 글은 받지 않는다.
const AlertSchema = z.object({
  event: z.enum(Object.keys(KINDS)),
  issue_id: z.uuid(),
  // 템플릿이 값을 채우지 못하면 "null" 같은 글자가 온다. 숫자가 하나도 없으면 시각으로 보지 않는다.
  exception_timestamp: z.string().max(100).regex(/\d/),
});

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// 모양이 맞지 않으면 null. 돌려준 값은 멱등 키와 워크플로우 입력에 그대로 들어간다.
export function parseAlert(body: unknown): OncallAlert | null {
  const parsed = AlertSchema.safeParse(body);
  if (!parsed.success) return null;

  const kind = KINDS[parsed.data.event];
  const issueId = parsed.data.issue_id.toLowerCase();
  // PostHog는 alert마다 고유 id를 주지 않는다. 같은 alert를 다시 보내도 종류, 이슈, 시각은 같다.
  const stamp = sha256(parsed.data.exception_timestamp).toString("hex").slice(0, 16);
  return { eventId: `${kind}:${issueId}:${stamp}`, kind, issueId };
}

// PostHog 웹훅은 본문에 서명하지 않으므로 alert에 설정한 Authorization 헤더의 공유 시크릿을 비교한다.
export function isAuthorized(header: string | null, secret: string): boolean {
  // timingSafeEqual은 길이가 다르면 던진다. 해시끼리 비교해 길이도 드러내지 않는다.
  return timingSafeEqual(sha256(header ?? ""), sha256(`Bearer ${secret}`));
}
