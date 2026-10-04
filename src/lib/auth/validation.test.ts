// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirm,
} from "@/lib/auth/validation";

describe("validateEmail", () => {
  it("빈 값이면 입력을 요청한다", () => {
    expect(validateEmail("")).toBe("이메일을 입력해 주세요.");
  });

  it.each(["user", "user@", "@example.com", "user@example", "us er@example.com"])(
    "형식이 틀린 이메일(%s)이면 오류 문구를 돌려준다",
    (email) => {
      expect(validateEmail(email)).toBe("이메일 형식이 올바르지 않아요.");
    },
  );

  it("정상 이메일이면 null", () => {
    expect(validateEmail("user@example.com")).toBeNull();
  });
});

describe("validatePassword", () => {
  it("빈 값이면 입력을 요청한다", () => {
    expect(validatePassword("")).toBe("비밀번호를 입력해 주세요.");
  });

  it("7자면 오류 문구를 돌려준다", () => {
    expect(validatePassword("1234567")).toBe("비밀번호는 8자 이상이어야 해요.");
  });

  it("8자 이상이면 null", () => {
    expect(validatePassword("12345678")).toBeNull();
  });
});

describe("validatePasswordConfirm", () => {
  it("빈 값이면 입력을 요청한다", () => {
    expect(validatePasswordConfirm("12345678", "")).toBe(
      "비밀번호를 한 번 더 입력해 주세요.",
    );
  });

  it("비밀번호와 다르면 오류 문구를 돌려준다", () => {
    expect(validatePasswordConfirm("12345678", "12345679")).toBe(
      "비밀번호가 일치하지 않아요.",
    );
  });

  it("비밀번호와 같으면 null", () => {
    expect(validatePasswordConfirm("12345678", "12345678")).toBeNull();
  });
});
