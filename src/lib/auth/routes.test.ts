// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveAuthRedirect } from "@/lib/auth/routes";

describe("resolveAuthRedirect", () => {
  it.each(["/dashboard", "/dashboard/anything"])(
    "비로그인 상태로 %s 에 오면 /login 으로 보낸다",
    (pathname) => {
      expect(resolveAuthRedirect(pathname, false)).toBe("/login");
    },
  );

  it.each(["/dashboard", "/dashboard/anything"])(
    "로그인 상태면 %s 를 그대로 둔다",
    (pathname) => {
      expect(resolveAuthRedirect(pathname, true)).toBeNull();
    },
  );

  it.each(["/login", "/signup"])(
    "로그인 상태로 %s 에 오면 /dashboard 로 보낸다",
    (pathname) => {
      expect(resolveAuthRedirect(pathname, true)).toBe("/dashboard");
    },
  );

  it.each(["/login", "/signup"])(
    "비로그인 상태면 %s 를 그대로 둔다",
    (pathname) => {
      expect(resolveAuthRedirect(pathname, false)).toBeNull();
    },
  );

  // /dashboardx 는 /dashboard 로 시작하지만 하위 경로가 아니다.
  it.each(["/", "/dashboardx", "/auth/confirm", "/sample"])(
    "%s 는 로그인 여부와 상관없이 그대로 둔다",
    (pathname) => {
      expect(resolveAuthRedirect(pathname, false)).toBeNull();
      expect(resolveAuthRedirect(pathname, true)).toBeNull();
    },
  );
});
