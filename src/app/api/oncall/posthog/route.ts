import { isAuthorized, parseAlert } from "@/lib/oncall/alert";
import { claimEvent, releaseEvent } from "@/lib/oncall/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchOncallAlert, OncallDispatchError } from "@/services/github";
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
      // 지우지 못하면 기록이 남아 재전송이 중복으로 끝난다. 이 alert를 잃었다는 흔적은 이 로그뿐이다.
      await releaseEvent(supabase, alert.eventId).catch(() => {
        console.error("on-call alert 기록을 지우지 못했어요. 이 alert는 다시 와도 넘어가지 않아요.");
      });
      throw error;
    }
    return Response.json({ status: "dispatched" } satisfies OncallWebhookResult);
  } catch (error) {
    // 200이 아닌 응답을 받은 PostHog가 같은 alert를 다시 보낸다.
    // 오류의 글에는 요청 정보가 섞일 수 있어 이름만 남긴다. GitHub가 거절했을 때는 상태 코드도 남긴다.
    const status = error instanceof OncallDispatchError ? ` HTTP 상태: ${error.status}` : "";
    console.error(`on-call alert를 넘기지 못했어요. 오류 종류: ${error instanceof Error ? error.name : "알 수 없음"}${status}`);
    return errorResponse("alert를 처리하지 못했어요.", 500);
  }
}
