// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toAuthErrorMessage } from "@/lib/auth/errors";

const FALLBACK = "문제가 생겼어요. 잠시 후 다시 시도해 주세요.";

describe("toAuthErrorMessage", () => {
  it.each([
    ["invalid_credentials", "이메일 또는 비밀번호가 올바르지 않아요."],
    [
      "email_not_confirmed",
      "이메일 확인이 필요해요. 받은 메일의 링크를 눌러 주세요.",
    ],
    ["user_already_exists", "이미 가입된 이메일이에요."],
    ["email_exists", "이미 가입된 이메일이에요."],
    ["weak_password", "비밀번호는 8자 이상이어야 해요."],
    ["over_request_rate_limit", "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
    [
      "over_email_send_rate_limit",
      "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
    ],
  ])("%s 코드를 한국어 문구로 바꾼다", (code, message) => {
    expect(toAuthErrorMessage({ code })).toBe(message);
  });

  it("알 수 없는 코드면 기본 문구를 돌려준다", () => {
    expect(toAuthErrorMessage({ code: "unexpected_failure" })).toBe(FALLBACK);
  });

  it("코드가 없으면 Supabase의 영어 문구를 쓰지 않고 기본 문구를 돌려준다", () => {
    expect(toAuthErrorMessage({ message: "fetch failed" })).toBe(FALLBACK);
  });
});
