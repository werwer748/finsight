// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseEnv, hasSupabaseEnv } from "@/lib/supabase/env";

const URL_NAME = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_NAME = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

// 개발자 셸에 실제 값이 있어도 결과가 달라지지 않도록 두 변수를 항상 직접 지정한다.
function stubEnv(url: string | undefined, key: string | undefined): void {
  vi.stubEnv(URL_NAME, url);
  vi.stubEnv(KEY_NAME, key);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSupabaseEnv", () => {
  it("두 환경변수가 모두 있으면 값을 돌려준다", () => {
    stubEnv("https://example.supabase.co", "sb_publishable_test");

    expect(getSupabaseEnv()).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
    });
  });

  it("URL이 없으면 그 변수 이름만 들어간 오류를 던진다", () => {
    stubEnv(undefined, "sb_publishable_test");

    expect(() => getSupabaseEnv()).toThrow(URL_NAME);
    expect(() => getSupabaseEnv()).not.toThrow(KEY_NAME);
  });

  it("publishable key가 없으면 그 변수 이름만 들어간 오류를 던진다", () => {
    stubEnv("https://example.supabase.co", undefined);

    expect(() => getSupabaseEnv()).toThrow(KEY_NAME);
    expect(() => getSupabaseEnv()).not.toThrow(URL_NAME);
  });

  it("둘 다 없으면 두 변수 이름이 모두 들어간 오류를 던진다", () => {
    stubEnv(undefined, undefined);

    expect(() => getSupabaseEnv()).toThrow(URL_NAME);
    expect(() => getSupabaseEnv()).toThrow(KEY_NAME);
  });

  it("값이 빈 문자열이면 없는 것으로 본다", () => {
    // .env.example을 그대로 복사하면 두 값이 빈 문자열이 된다.
    stubEnv("", "");

    expect(() => getSupabaseEnv()).toThrow(URL_NAME);
  });
});

describe("hasSupabaseEnv", () => {
  it("두 환경변수가 모두 있으면 true", () => {
    stubEnv("https://example.supabase.co", "sb_publishable_test");

    expect(hasSupabaseEnv()).toBe(true);
  });

  it("하나라도 없으면 던지지 않고 false", () => {
    stubEnv("https://example.supabase.co", undefined);
    expect(hasSupabaseEnv()).toBe(false);

    stubEnv(undefined, "sb_publishable_test");
    expect(hasSupabaseEnv()).toBe(false);
  });

  it("값이 빈 문자열이면 false", () => {
    stubEnv("", "");

    expect(hasSupabaseEnv()).toBe(false);
  });
});
