import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

let loggerProvider: LoggerProvider | null | undefined;

// 환경변수는 처음 쓸 때 읽는다. 설정이 없으면 로그를 보내지 않는다.
function getLoggerProvider(): LoggerProvider | null {
  if (loggerProvider === undefined) {
    const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    try {
      loggerProvider =
        projectToken && host
          ? new LoggerProvider({
              resource: resourceFromAttributes({ "service.name": "finsight" }),
              processors: [
                new BatchLogRecordProcessor({
                  exporter: new OTLPLogExporter({
                    url: new URL("/i/v1/logs", host).toString(),
                    headers: {
                      Authorization: `Bearer ${projectToken}`,
                      "Content-Type": "application/json",
                    },
                  }),
                }),
              ],
            })
          : null;
    } catch {
      // 호스트 값이 주소가 아니면 new URL()이 던진다. 로그 때문에 로그인 같은 요청이 실패하지 않게 끈다.
      loggerProvider = null;
    }
  }

  return loggerProvider;
}

export function logAuthEvent(message: string, authFlow: string): void {
  getLoggerProvider()
    ?.getLogger("finsight.posthog.auth")
    .emit({
      body: message,
      severityNumber: SeverityNumber.INFO,
      attributes: { auth_flow: authFlow },
    });
}

// 오류 코드만 남긴다. Supabase의 오류 메시지에는 이메일 같은 입력값이 섞일 수 있어 보내지 않는다.
export function logAuthFailure(
  message: string,
  authFlow: string,
  errorCode: string | undefined,
): void {
  getLoggerProvider()
    ?.getLogger("finsight.posthog.auth")
    .emit({
      body: message,
      severityNumber: SeverityNumber.WARN,
      attributes: { auth_flow: authFlow, error_code: errorCode ?? "unknown" },
    });
}

// 오류 이름과 digest만 남긴다. 오류 메시지에는 사용자 데이터가 섞일 수 있어 보내지 않는다.
// 전체 메시지와 스택은 Next가 서버 콘솔에 남기므로 호스팅 쪽 런타임 로그에서 본다.
export function logRequestError(
  error: unknown,
  request: { routePath: string; routeType: string; method: string },
): void {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;

  getLoggerProvider()
    ?.getLogger("finsight.posthog.server")
    .emit({
      body: "Server request failed",
      severityNumber: SeverityNumber.ERROR,
      attributes: {
        error_name: error instanceof Error ? error.name : "unknown",
        ...(digest && { error_digest: digest }),
        route_path: request.routePath,
        route_type: request.routeType,
        http_method: request.method,
      },
    });
}

// timeoutMillis를 넘기면 그 시간 안에 끝나지 않을 때 거부된다. 넘기지 않으면 SDK 기본값(30초)을 쓴다.
export async function flushPostHogLogs(timeoutMillis?: number): Promise<void> {
  await getLoggerProvider()?.forceFlush({ timeoutMillis });
}
