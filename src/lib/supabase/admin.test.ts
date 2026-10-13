// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const URL_NAME = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_NAME = "SUPABASE_SECRET_KEY";
const supabaseClient = { from: vi.fn() };

beforeEach(() => {
  vi.stubEnv(URL_NAME, "https://example.supabase.co");
  vi.stubEnv(KEY_NAME, "sb_secret_test");
  vi.mocked(createClient).mockReturnValue(supabaseClient as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("createAdminClient", () => {
  it("secret key로 세션을 저장하지 않는 클라이언트를 만든다", () => {
    const client = createAdminClient();

    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "sb_secret_test", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(client).toBe(supabaseClient);
  });

  it("secret key가 없으면 그 변수 이름만 들어간 오류를 던진다", () => {
    vi.stubEnv(KEY_NAME, "");

    expect(() => createAdminClient()).toThrow(KEY_NAME);
    expect(() => createAdminClient()).not.toThrow(URL_NAME);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("URL이 없으면 그 변수 이름만 들어간 오류를 던진다", () => {
    vi.stubEnv(URL_NAME, undefined);

    expect(() => createAdminClient()).toThrow(URL_NAME);
    expect(() => createAdminClient()).not.toThrow(KEY_NAME);
  });

  it("publishable key로 대신하지 않는다", () => {
    // publishable key로는 정책 없는 테이블에 쓸 수 없어 모든 alert가 실패한다. 설정 누락을 바로 드러낸다.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv(KEY_NAME, undefined);

    expect(() => createAdminClient()).toThrow(KEY_NAME);
  });
});
