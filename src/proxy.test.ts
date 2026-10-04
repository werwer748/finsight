// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSession } from "@/lib/supabase/update-session";
import { proxy } from "@/proxy";

vi.mock("@/lib/supabase/update-session", () => ({ updateSession: vi.fn() }));

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

// updateSession이 세션을 갱신해 쿠키가 담긴 응답을 돌려준 상황을 만든다.
// 세션이 크면 Supabase가 쿠키를 여러 조각으로 나눠 담는다.
function mockSession(isAuthenticated: boolean): NextResponse {
  const response = NextResponse.next();
  response.cookies.set("sb-test-auth-token.0", "refreshed-0", {
    path: "/",
    httpOnly: true,
  });
  response.cookies.set("sb-test-auth-token.1", "refreshed-1", {
    path: "/",
    httpOnly: true,
  });
  vi.mocked(updateSession).mockResolvedValue({ response, isAuthenticated });
  return response;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("proxy", () => {
  it("비로그인 상태의 /dashboard 요청은 /login 으로 리다이렉트한다", async () => {
    mockSession(false);

    const response = await proxy(request("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login",
    );
  });

  it("로그인 상태의 /login 요청은 쿼리 없이 /dashboard 로 리다이렉트한다", async () => {
    mockSession(true);

    const response = await proxy(request("/login?notice=confirm-failed"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  it("리다이렉트 응답에 updateSession이 담은 세션 쿠키를 전부 복사한다", async () => {
    mockSession(true);

    const response = await proxy(request("/login"));

    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-test-auth-token.0")).toMatchObject({
      value: "refreshed-0",
      path: "/",
      httpOnly: true,
    });
    expect(response.cookies.get("sb-test-auth-token.1")).toMatchObject({
      value: "refreshed-1",
      path: "/",
      httpOnly: true,
    });
  });

  it.each([
    ["로그인", "/dashboard", true],
    ["비로그인", "/login", false],
    ["비로그인", "/", false],
    ["로그인", "/", true],
  ])(
    "%s 상태의 %s 요청은 updateSession의 응답을 그대로 돌려준다",
    async (_label, path, isAuthenticated) => {
      const sessionResponse = mockSession(isAuthenticated);

      const response = await proxy(request(path));

      expect(response).toBe(sessionResponse);
      expect(response.headers.has("location")).toBe(false);
    },
  );
});
