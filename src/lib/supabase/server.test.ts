// @vitest-environment node
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";

vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const cookieStore = { getAll: vi.fn(), set: vi.fn() };
const supabaseClient = { auth: {} };

// createClient가 createServerClient에 넘긴 쿠키 어댑터를 꺼낸다.
async function createCookieAdapter() {
  await createClient();
  return vi.mocked(createServerClient).mock.calls[0][2].cookies;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.mocked(cookies).mockResolvedValue(
    cookieStore as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  vi.mocked(createServerClient).mockReturnValue(supabaseClient as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("createClient", () => {
  it("환경변수 값으로 createServerClient를 호출하고 그 클라이언트를 돌려준다", async () => {
    const client = await createClient();

    expect(createServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_publishable_test",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(client).toBe(supabaseClient);
  });

  it("쿠키 어댑터의 getAll이 쿠키 저장소의 값을 돌려준다", async () => {
    const stored = [{ name: "sb-test-auth-token", value: "token" }];
    cookieStore.getAll.mockReturnValue(stored);

    const adapter = await createCookieAdapter();

    expect(adapter.getAll()).toEqual(stored);
  });

  it("쿠키 어댑터의 setAll이 쿠키 저장소에 쿠키를 쓴다", async () => {
    const adapter = await createCookieAdapter();

    adapter.setAll?.(
      [{ name: "sb-test-auth-token", value: "token", options: { path: "/" } }],
      {},
    );

    expect(cookieStore.set).toHaveBeenCalledWith("sb-test-auth-token", "token", {
      path: "/",
    });
  });

  it("setAll에서 쿠키 저장소가 예외를 던져도 전파하지 않는다", async () => {
    // 서버 컴포넌트에서는 쿠키를 쓸 수 없어 set이 예외를 던진다.
    cookieStore.set.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });

    const adapter = await createCookieAdapter();

    expect(() =>
      adapter.setAll?.(
        [{ name: "sb-test-auth-token", value: "token", options: {} }],
        {},
      ),
    ).not.toThrow();
    expect(cookieStore.set).toHaveBeenCalled();
  });
});
