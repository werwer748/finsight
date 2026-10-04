// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const auth = { getClaims: vi.fn(), getSession: vi.fn() };

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({ auth } as never);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("getCurrentUser", () => {
  it("claims가 있으면 sub를 id로, email을 email로 돌려준다", async () => {
    auth.getClaims.mockResolvedValue({
      data: {
        claims: {
          sub: "user-1",
          email: "user@example.com",
          role: "authenticated",
        },
      },
      error: null,
    });

    await expect(getCurrentUser()).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
    });
  });

  it("claims가 없으면 null", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("getClaims()가 오류를 돌려주면 null", async () => {
    auth.getClaims.mockResolvedValue({
      data: null,
      error: new Error("invalid JWT"),
    });

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("claims에 email이 없으면 빈 문자열로 돌려준다", async () => {
    auth.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
      error: null,
    });

    await expect(getCurrentUser()).resolves.toEqual({ id: "user-1", email: "" });
  });

  it("검증되지 않은 getSession()은 쓰지 않는다", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });

    await getCurrentUser();

    expect(auth.getClaims).toHaveBeenCalledTimes(1);
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});
