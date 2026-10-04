// @vitest-environment node
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, signOut, signUp } from "@/lib/auth/actions";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

const auth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
};

function form(fields: Record<string, string>): FormData {
  const formData = new FormData();
  Object.entries(fields).forEach(([name, value]) => formData.set(name, value));
  return formData;
}

const signupFields = {
  email: "user@example.com",
  password: "password123",
  passwordConfirm: "password123",
};
const loginFields = { email: "user@example.com", password: "password123" };

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({ auth } as never);
  vi.mocked(headers).mockResolvedValue(
    new Headers({ origin: "https://finsight.example" }) as never,
  );
  // 실제 redirect()처럼 예외를 던져 뒤의 코드가 실행되지 않게 한다.
  vi.mocked(redirect).mockImplementation((url) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  auth.signUp.mockResolvedValue({
    data: { user: { id: "user-1" }, session: null },
    error: null,
  });
  auth.signInWithPassword.mockResolvedValue({
    data: { user: { id: "user-1" }, session: { access_token: "token" } },
    error: null,
  });
  auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("signUp", () => {
  it("입력이 비어 있으면 필드별 오류를 돌려주고 Supabase를 호출하지 않는다", async () => {
    const state = await signUp({}, form({}));

    expect(state.errors).toEqual({
      email: "이메일을 입력해 주세요.",
      password: "비밀번호를 입력해 주세요.",
      passwordConfirm: "비밀번호를 한 번 더 입력해 주세요.",
    });
    expect(state.success).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("문제가 있는 필드의 오류만 돌려준다", async () => {
    const state = await signUp(
      {},
      form({ ...signupFields, passwordConfirm: "password124" }),
    );

    expect(state.errors).toEqual({
      passwordConfirm: "비밀번호가 일치하지 않아요.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("검증을 통과하면 요청 origin의 /auth/confirm 을 emailRedirectTo로 넘긴다", async () => {
    await signUp({}, form(signupFields));

    expect(auth.signUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
      options: { emailRedirectTo: "https://finsight.example/auth/confirm" },
    });
  });

  it("응답에 세션이 없으면 확인 메일 안내를 돌려준다", async () => {
    const state = await signUp({}, form(signupFields));

    expect(state).toEqual({
      success: true,
      message: "확인 메일을 보냈어요. 메일의 링크를 눌러 가입을 마쳐 주세요.",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("응답에 세션이 있으면 /dashboard 로 리다이렉트한다", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "token" } },
      error: null,
    });

    await expect(signUp({}, form(signupFields))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("Supabase가 오류를 돌려주면 한국어 문구를 message에 담는다", async () => {
    auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "over_email_send_rate_limit", message: "rate limit" },
    });

    const state = await signUp({}, form(signupFields));

    expect(state).toEqual({
      message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("반환값에 비밀번호를 담지 않는다", async () => {
    const succeeded = await signUp({}, form(signupFields));
    const rejected = await signUp(
      {},
      form({ ...signupFields, email: "", passwordConfirm: "password124" }),
    );

    expect(JSON.stringify([succeeded, rejected])).not.toContain("password12");
  });
});

describe("signIn", () => {
  it("검증에 실패하면 필드별 오류를 돌려주고 Supabase를 호출하지 않는다", async () => {
    const state = await signIn({}, form({ email: "user", password: "" }));

    expect(state.errors).toEqual({
      email: "이메일 형식이 올바르지 않아요.",
      password: "비밀번호를 입력해 주세요.",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("로그인에 성공하면 /dashboard 로 리다이렉트한다", async () => {
    await expect(signIn({}, form(loginFields))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
    });
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("로그인에 실패하면 한국어 문구를 message에 담고 리다이렉트하지 않는다", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });

    const state = await signIn({}, form(loginFields));

    expect(state).toEqual({ message: "이메일 또는 비밀번호가 올바르지 않아요." });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("Supabase에서 로그아웃한 뒤 / 로 리다이렉트한다", async () => {
    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/");

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
