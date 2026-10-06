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

// Supabase가 세션 쿠키를 설정할 때 함께 넘기는 캐시 방지 헤더.
const cacheHeaders = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

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
    ["로그인", "/login", true],
    ["비로그인", "/dashboard", false],
  ])(
    "%s 상태의 %s 리다이렉트 응답에 updateSession이 담은 캐시 방지 헤더를 복사한다",
    async (_label, path, isAuthenticated) => {
      const sessionResponse = mockSession(isAuthenticated);
      Object.entries(cacheHeaders).forEach(([name, value]) =>
        sessionResponse.headers.set(name, value),
      );

      const response = await proxy(request(path));

      expect(response.status).toBe(307);
      expect(response.headers.get("Cache-Control")).toBe(
        cacheHeaders["Cache-Control"],
      );
      expect(response.headers.get("Expires")).toBe(cacheHeaders.Expires);
      expect(response.headers.get("Pragma")).toBe(cacheHeaders.Pragma);
      expect(response.cookies.get("sb-test-auth-token.0")).toMatchObject({
        value: "refreshed-0",
        path: "/",
        httpOnly: true,
      });
    },
  );

  it("updateSession이 캐시 방지 헤더를 담지 않았으면 리다이렉트 응답에도 붙이지 않는다", async () => {
    mockSession(true);

    const response = await proxy(request("/login"));

    expect(response.status).toBe(307);
    expect(response.headers.has("Cache-Control")).toBe(false);
    expect(response.headers.has("Expires")).toBe(false);
    expect(response.headers.has("Pragma")).toBe(false);
  });

  it("캐시 방지 헤더 외에 updateSession 응답의 다른 헤더는 리다이렉트 응답에 옮기지 않는다", async () => {
    const sessionResponse = mockSession(true);
    sessionResponse.headers.set("x-custom", "value");

    const response = await proxy(request("/login"));

    expect(sessionResponse.headers.has("x-middleware-next")).toBe(true);
    expect(response.headers.has("x-middleware-next")).toBe(false);
    expect(response.headers.has("x-custom")).toBe(false);
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
