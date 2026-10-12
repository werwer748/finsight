import type { Instrumentation } from "next";
import { flushPostHogLogs, logRequestError } from "@/lib/posthog/logs";

// 라우트 핸들러와 proxy에서는 Next가 이 훅이 끝나야 오류 응답을 보낸다.
const FLUSH_TIMEOUT_MS = 2000;

// 서버에서 난 오류를 PostHog 로그로 보낸다.
// 브라우저에는 digest만 내려가므로 여기서 남기지 않으면 PostHog에서 원인을 찾을 단서가 없다.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  // request.path에는 확인 링크의 토큰이, request.headers에는 세션 쿠키가 들어 있어 넘기지 않는다.
  logRequestError(error, {
    routePath: context.routePath,
    routeType: context.routeType,
    method: request.method,
  });
  // 여기서 기다리지 않으면 로그를 내보내기 전에 서버리스 인스턴스가 멈출 수 있다.
  // 제한 시간을 넘기면 거부되고, Next가 그 사실을 서버 콘솔에 남긴 뒤 원래 오류 응답을 그대로 보낸다.
  await flushPostHogLogs(FLUSH_TIMEOUT_MS);
};
