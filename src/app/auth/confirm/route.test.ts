// @vitest-environment node
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/auth/confirm/route";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

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
});
