// @vitest-environment node
import { redirect } from "next/navigation";
import { after, NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/confirm/route";
import {
  flushPostHogLogs,
  logAuthEvent,
  logAuthFailure,
} from "@/lib/posthog/logs";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
// after()는 요청 범위 밖에서 부르면 예외를 던지므로 NextRequest만 실제 구현을 쓴다.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/posthog/logs", () => ({
  logAuthEvent: vi.fn(),
  logAuthFailure: vi.fn(),
  flushPostHogLogs: vi.fn(),
}));

const auth = { verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn() };
const FAILED = "/login?notice=confirm-failed";

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/auth/confirm${query}`);
}

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({ auth } as never);
  // 실제 redirect()처럼 예외를 던져 뒤의 코드가 실행되지 않게 한다.
  vi.mocked(redirect).mockImplementation((url) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("GET /auth/confirm", () => {
  it("token_hash와 type이 있으면 verifyOtp로 확인하고 /dashboard 로 보낸다", async () => {
    await expect(GET(request("?token_hash=hash-1&type=email"))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash-1",
      type: "email",
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("code가 있으면 exchangeCodeForSession으로 교환하고 /dashboard 로 보낸다", async () => {
    await expect(GET(request("?code=code-1"))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("code-1");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifyOtp가 실패하면 로그인 화면으로 보낸다", async () => {
    auth.verifyOtp.mockResolvedValue({
      error: { code: "otp_expired", message: "Token has expired" },
    });

    await expect(GET(request("?token_hash=hash-1&type=email"))).rejects.toThrow(
      `NEXT_REDIRECT:${FAILED}`,
    );
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("코드 교환이 실패하면 로그인 화면으로 보낸다", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      error: { code: "bad_code_verifier", message: "invalid" },
    });

    await expect(GET(request("?code=code-1"))).rejects.toThrow(
      `NEXT_REDIRECT:${FAILED}`,
    );
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("쿼리가 없으면 Supabase를 호출하지 않고 로그인 화면으로 보낸다", async () => {
    await expect(GET(request(""))).rejects.toThrow(`NEXT_REDIRECT:${FAILED}`);

    expect(createClient).not.toHaveBeenCalled();
  });

  it("token_hash만 있고 type이 없으면 로그인 화면으로 보낸다", async () => {
    await expect(GET(request("?token_hash=hash-1"))).rejects.toThrow(
      `NEXT_REDIRECT:${FAILED}`,
    );

    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("확인에 성공하면 성공 로그를 남기고 응답 뒤에 내보낸다", async () => {
    await expect(GET(request("?code=code-1"))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );

    expect(logAuthEvent).toHaveBeenCalledWith(
      "Authentication email confirmation succeeded",
      "email_confirmation",
    );
    expect(logAuthFailure).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(flushPostHogLogs);
  });

  it("링크에 필요한 값이 없으면 missing_params 로 실패 로그를 남기고 응답 뒤에 내보낸다", async () => {
    await expect(GET(request(""))).rejects.toThrow(`NEXT_REDIRECT:${FAILED}`);

    expect(logAuthEvent).not.toHaveBeenCalled();
    expect(logAuthFailure).toHaveBeenCalledTimes(1);
    expect(logAuthFailure).toHaveBeenCalledWith(
      "Authentication email confirmation failed",
      "email_confirmation",
      "missing_params",
    );
    expect(after).toHaveBeenCalledWith(flushPostHogLogs);
  });

  it("verifyOtp가 실패하면 Supabase 오류 코드만 실패 로그에 남긴다", async () => {
    auth.verifyOtp.mockResolvedValue({
      error: { code: "otp_expired", message: "Token has expired" },
    });

    await expect(GET(request("?token_hash=hash-1&type=email"))).rejects.toThrow(
      `NEXT_REDIRECT:${FAILED}`,
    );

    expect(logAuthFailure).toHaveBeenCalledTimes(1);
    expect(logAuthFailure).toHaveBeenCalledWith(
      "Authentication email confirmation failed",
      "email_confirmation",
      "otp_expired",
    );
  });

  it("코드 교환이 실패하면 Supabase 오류 코드만 실패 로그에 남긴다", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({
      error: { code: "bad_code_verifier", message: "invalid" },
    });

    await expect(GET(request("?code=code-1"))).rejects.toThrow(
      `NEXT_REDIRECT:${FAILED}`,
    );

    expect(logAuthFailure).toHaveBeenCalledTimes(1);
    expect(logAuthFailure).toHaveBeenCalledWith(
      "Authentication email confirmation failed",
      "email_confirmation",
      "bad_code_verifier",
    );
  });
});
