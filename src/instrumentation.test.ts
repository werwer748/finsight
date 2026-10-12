// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestError } from "@/instrumentation";
import { flushPostHogLogs, logRequestError } from "@/lib/posthog/logs";

vi.mock("@/lib/posthog/logs", () => ({
  logRequestError: vi.fn(),
  flushPostHogLogs: vi.fn(),
}));

const request = {
  path: "/auth/confirm?token_hash=hash-1&type=email",
  method: "GET",
  headers: { cookie: "sb-access-token=secret" },
};
const context = {
  routerKind: "App Router",
  routePath: "/auth/confirm/route",
  routeType: "route",
  revalidateReason: undefined,
} as const;

afterEach(() => {
  vi.resetAllMocks();
});

describe("onRequestError", () => {
  it("서버 오류를 경로 패턴, 종류, 메서드와 함께 PostHog 로그로 남긴다", async () => {
    const error = new Error("boom");

    await onRequestError(error, request, context);

    expect(logRequestError).toHaveBeenCalledTimes(1);
    expect(logRequestError).toHaveBeenCalledWith(error, {
      routePath: "/auth/confirm/route",
      routeType: "route",
      method: "GET",
    });
  });

  it("토큰이 붙은 요청 경로와 쿠키가 든 헤더는 넘기지 않는다", async () => {
    await onRequestError(new Error("boom"), request, context);

    const passed = JSON.stringify(vi.mocked(logRequestError).mock.calls[0][1]);
    expect(passed).not.toContain("hash-1");
    expect(passed).not.toContain("secret");
  });

  it("PostHog가 느려도 오류 응답을 오래 붙잡지 않게 내보내기에 제한 시간을 건다", async () => {
    await onRequestError(new Error("boom"), request, context);

    expect(flushPostHogLogs).toHaveBeenCalledTimes(1);
    expect(flushPostHogLogs).toHaveBeenCalledWith(2000);
  });

  it("로그를 다 내보낼 때까지 기다린다", async () => {
    let flushed = false;
    vi.mocked(flushPostHogLogs).mockImplementation(async () => {
      await Promise.resolve();
      flushed = true;
    });

    await onRequestError(new Error("boom"), request, context);

    expect(flushed).toBe(true);
  });
});
