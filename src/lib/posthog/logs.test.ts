// @vitest-environment node
import { SeverityNumber } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, it, vi } from "vitest";

const otel = vi.hoisted(() => ({
  exporter: vi.fn(),
  emit: vi.fn(),
  forceFlush: vi.fn(),
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    constructor(options: unknown) {
      otel.exporter(options);
    }
  },
}));
vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: class {},
  LoggerProvider: class {
    forceFlush = otel.forceFlush;
    getLogger() {
      return { emit: otel.emit };
    }
  },
}));

// 설정은 처음 쓸 때 한 번 읽어 두므로 환경변수를 바꾼 뒤 새로 불러온다.
async function load(env: Record<string, string>) {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
  Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
  vi.resetModules();
  return import("@/lib/posthog/logs");
}

const configured = {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
  NEXT_PUBLIC_POSTHOG_HOST: "https://posthog.example",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("PostHog 서버 로그", () => {
  it("설정이 없으면 아무것도 보내지 않고 예외도 던지지 않는다", async () => {
    const { logAuthEvent, flushPostHogLogs } = await load({});

    logAuthEvent("Authentication sign-in succeeded", "sign_in");
    await expect(flushPostHogLogs()).resolves.toBeUndefined();

    expect(otel.exporter).not.toHaveBeenCalled();
    expect(otel.emit).not.toHaveBeenCalled();
    expect(otel.forceFlush).not.toHaveBeenCalled();
  });

  it("설정이 있으면 호스트의 로그 수집 주소로 프로젝트 토큰을 실어 보낸다", async () => {
    const { logAuthEvent } = await load(configured);

    logAuthEvent("Authentication sign-in succeeded", "sign_in");
    logAuthEvent("Authentication sign-out completed", "sign_out");

    expect(otel.exporter).toHaveBeenCalledTimes(1);
    expect(otel.exporter).toHaveBeenCalledWith({
      url: "https://posthog.example/i/v1/logs",
      headers: {
        Authorization: "Bearer phc_test",
        "Content-Type": "application/json",
      },
    });
  });

  it("logAuthEvent는 문구와 인증 흐름 이름만 담아 기록한다", async () => {
    const { logAuthEvent } = await load(configured);

    logAuthEvent("Authentication sign-in succeeded", "sign_in");

    expect(otel.emit).toHaveBeenCalledWith({
      body: "Authentication sign-in succeeded",
      severityNumber: SeverityNumber.INFO,
      attributes: { auth_flow: "sign_in" },
    });
  });

  it("logAuthFailure는 경고 수준으로 문구, 인증 흐름 이름, 오류 코드만 담아 기록한다", async () => {
    const { logAuthFailure } = await load(configured);

    logAuthFailure("Authentication sign-in failed", "sign_in", "invalid_credentials");

    expect(otel.emit).toHaveBeenCalledWith({
      body: "Authentication sign-in failed",
      severityNumber: SeverityNumber.WARN,
      attributes: { auth_flow: "sign_in", error_code: "invalid_credentials" },
    });
  });

  it("logAuthFailure는 오류 코드가 없으면 unknown으로 기록한다", async () => {
    const { logAuthFailure } = await load(configured);

    logAuthFailure("Authentication sign-in failed", "sign_in", undefined);

    expect(otel.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: { auth_flow: "sign_in", error_code: "unknown" },
      }),
    );
  });

  it("호스트 값이 주소가 아니면 예외 없이 아무것도 보내지 않는다", async () => {
    const { logAuthEvent, logAuthFailure, flushPostHogLogs } = await load({
      ...configured,
      NEXT_PUBLIC_POSTHOG_HOST: "주소가 아닌 값",
    });

    expect(() =>
      logAuthEvent("Authentication sign-in succeeded", "sign_in"),
    ).not.toThrow();
    expect(() =>
      logAuthFailure("Authentication sign-in failed", "sign_in", undefined),
    ).not.toThrow();
    await expect(flushPostHogLogs()).resolves.toBeUndefined();

    expect(otel.emit).not.toHaveBeenCalled();
    expect(otel.forceFlush).not.toHaveBeenCalled();
  });

  it("logRequestError는 오류 수준으로 오류 이름, digest, 경로 패턴만 담아 기록한다", async () => {
    const { logRequestError } = await load(configured);
    const error = Object.assign(
      new TypeError("duplicate key (email)=(user@example.com)"),
      { digest: "1234567890" },
    );

    logRequestError(error, {
      routePath: "/dashboard",
      routeType: "render",
      method: "GET",
    });

    expect(otel.emit).toHaveBeenCalledWith({
      body: "Server request failed",
      severityNumber: SeverityNumber.ERROR,
      attributes: {
        error_name: "TypeError",
        error_digest: "1234567890",
        route_path: "/dashboard",
        route_type: "render",
        http_method: "GET",
      },
    });
    expect(JSON.stringify(otel.emit.mock.calls)).not.toContain("user@example.com");
  });

  it("logRequestError는 Error가 아닌 값이 던져져도 기록한다", async () => {
    const { logRequestError } = await load(configured);

    logRequestError("boom", {
      routePath: "/auth/confirm/route",
      routeType: "route",
      method: "GET",
    });

    expect(otel.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          error_name: "unknown",
          route_path: "/auth/confirm/route",
          route_type: "route",
          http_method: "GET",
        },
      }),
    );
  });

  it("flushPostHogLogs는 쌓인 로그를 내보낸다", async () => {
    const { flushPostHogLogs } = await load(configured);

    await flushPostHogLogs();

    expect(otel.forceFlush).toHaveBeenCalledTimes(1);
  });

  it("flushPostHogLogs에 제한 시간을 주면 그 시간까지만 기다리게 한다", async () => {
    const { flushPostHogLogs } = await load(configured);

    await flushPostHogLogs(2000);

    expect(otel.forceFlush).toHaveBeenCalledWith({ timeoutMillis: 2000 });
  });

  it("import만으로는 환경변수를 읽지 않아 값이 잘못돼 있어도 예외가 나지 않는다", async () => {
    await expect(
      load({ ...configured, NEXT_PUBLIC_POSTHOG_HOST: "주소가 아닌 값" }),
    ).resolves.toBeDefined();

    expect(otel.exporter).not.toHaveBeenCalled();
  });

  it("개발 환경에서 설정이 빠져도 예외를 던지지 않는다", async () => {
    const { logAuthEvent, flushPostHogLogs } = await load({
      NODE_ENV: "development",
    });

    expect(() =>
      logAuthEvent("Authentication sign-in succeeded", "sign_in"),
    ).not.toThrow();
    await expect(flushPostHogLogs()).resolves.toBeUndefined();
  });
});
