// @vitest-environment node
import { createServerClient } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "@/lib/supabase/update-session";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));

const getClaims = vi.fn();
const claims = { data: { claims: { sub: "user-1" } }, error: null };
const refreshedCookie = {
  name: "sb-test-auth-token",
  value: "refreshed",
  options: { path: "/", httpOnly: true },
};

function createRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost:3000/", {
    headers: cookie ? { cookie } : undefined,
  });
}

// updateSession이 createServerClient에 넘긴 쿠키 어댑터를 꺼낸다.
function cookieAdapter() {
  return vi.mocked(createServerClient).mock.calls[0][2].cookies;
}

// 실제 Supabase처럼 getClaims() 도중에 토큰을 갱신해 setAll을 부른다.
function refreshTokenDuringGetClaims(headers: Record<string, string> = {}) {
  getClaims.mockImplementation(async () => {
    await cookieAdapter().setAll?.([refreshedCookie], headers);
    return claims;
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.mocked(createServerClient).mockReturnValue({
    auth: { getClaims },
  } as never);
  getClaims.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("updateSession", () => {
  it("환경변수가 없으면 Supabase를 호출하지 않고 요청을 그대로 통과시킨다", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);

    const { response, isAuthenticated } = await updateSession(createRequest());

    expect(createServerClient).not.toHaveBeenCalled();
    expect(isAuthenticated).toBe(false);
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });

  it("환경변수 값으로 클라이언트를 만들고 getClaims()로 토큰을 검증한다", async () => {
    await updateSession(createRequest());

    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_publishable_test",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("claims가 있으면 isAuthenticated가 true", async () => {
    getClaims.mockResolvedValue(claims);

    const { isAuthenticated } = await updateSession(createRequest());

    expect(isAuthenticated).toBe(true);
  });

  it("claims가 없으면 isAuthenticated가 false", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const { isAuthenticated } = await updateSession(createRequest());

    expect(isAuthenticated).toBe(false);
  });

  it("getClaims()가 오류를 돌려주면 isAuthenticated가 false", async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: new Error("invalid JWT"),
    });

    const { isAuthenticated } = await updateSession(createRequest());

    expect(isAuthenticated).toBe(false);
  });

  it("쿠키 어댑터의 getAll이 요청의 쿠키를 돌려준다", async () => {
    await updateSession(createRequest("sb-test-auth-token=token"));

    expect(cookieAdapter().getAll()).toEqual([
      { name: "sb-test-auth-token", value: "token" },
    ]);
  });

  it("Supabase가 설정한 쿠키를 응답에 담는다", async () => {
    refreshTokenDuringGetClaims();

    const { response, isAuthenticated } = await updateSession(createRequest());

    expect(response.cookies.get("sb-test-auth-token")).toMatchObject({
      value: "refreshed",
      path: "/",
      httpOnly: true,
    });
    expect(isAuthenticated).toBe(true);
  });

  it("Supabase가 설정한 쿠키를 요청에도 반영한다", async () => {
    refreshTokenDuringGetClaims();
    const request = createRequest("sb-test-auth-token=expired");

    await updateSession(request);

    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });

  it("Supabase가 넘긴 캐시 방지 헤더를 응답에 담는다", async () => {
    refreshTokenDuringGetClaims({ "Cache-Control": "private, no-store" });

    const { response } = await updateSession(createRequest());

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
