import { isAuthorized, parseAlert } from "@/lib/oncall/alert";
import { claimEvent, releaseEvent } from "@/lib/oncall/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchOncallAlert } from "@/services/github";
import type { OncallWebhookErrorBody, OncallWebhookResult } from "@/types/oncall";

function errorResponse(error: string, status: number): Response {
  return Response.json({ error } satisfies OncallWebhookErrorBody, { status });
}

// PostHog error tracking alert(이슈 생성·재발·급증)를 받는다.
// 여기서는 검증하고, 기록하고, CI에 넘기기만 한다. 판정과 에스컬레이션은 oncall-alert 워크플로우가 한다.
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ONCALL_WEBHOOK_SECRET;
  if (!secret) return errorResponse("on-call 웹훅이 설정되지 않았어요.", 503);
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return errorResponse("인증에 실패했어요.", 401);
  }

  const alert = parseAlert(await request.json().catch(() => null));
  if (!alert) return errorResponse("alert 본문이 올바르지 않아요.", 400);

  try {
    const supabase = createAdminClient();
    if (!(await claimEvent(supabase, alert.eventId))) {
      return Response.json({ status: "duplicate" } satisfies OncallWebhookResult);
    }
    try {
      await dispatchOncallAlert(alert);
    } catch (error) {
      await releaseEvent(supabase, alert.eventId);
      throw error;
    }
    return Response.json({ status: "dispatched" } satisfies OncallWebhookResult);
  } catch (error) {
    // 200이 아닌 응답을 받은 PostHog가 같은 alert를 다시 보낸다.
    console.error(`on-call alert를 넘기지 못했어요. 오류 종류: ${error instanceof Error ? error.name : "알 수 없음"}`);
    return errorResponse("alert를 처리하지 못했어요.", 500);
  }
}
