import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "@/components/auth/signup-form";
import { signUp } from "@/lib/auth/actions";
import type { AuthFormState } from "@/types/auth";

vi.mock("@/lib/auth/actions", () => ({ signUp: vi.fn() }));

const SENT = "확인 메일을 보냈어요. 메일의 링크를 눌러 가입을 마쳐 주세요.";

async function submit(
  email = "user@example.com",
  password = "password123",
  passwordConfirm = password,
) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("이메일"), email);
  await user.type(screen.getByLabelText("비밀번호"), password);
  await user.type(screen.getByLabelText("비밀번호 확인"), passwordConfirm);
  await user.click(screen.getByRole("button", { name: "가입하기" }));
}

beforeEach(() => {
  vi.mocked(signUp).mockResolvedValue({});
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("SignupForm", () => {
  it("이메일, 비밀번호, 비밀번호 확인 입력을 라벨로 찾을 수 있다", () => {
    render(<SignupForm />);

    expect(screen.getByLabelText("이메일")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("비밀번호 확인")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("제출하면 입력값을 서버 액션에 넘긴다", async () => {
    render(<SignupForm />);

    await submit();

    const formData = vi.mocked(signUp).mock.calls[0][1];
    expect(formData.get("email")).toBe("user@example.com");
    expect(formData.get("password")).toBe("password123");
    expect(formData.get("passwordConfirm")).toBe("password123");
  });

  it("액션이 돌려준 필드별 오류를 입력 아래에 보여준다", async () => {
    vi.mocked(signUp).mockResolvedValue({
      errors: {
        email: "이메일 형식이 올바르지 않아요.",
        password: "비밀번호는 8자 이상이어야 해요.",
        passwordConfirm: "비밀번호가 일치하지 않아요.",
      },
    });
    render(<SignupForm />);

    await submit("user", "1234567", "7654321");

    expect(await screen.findByLabelText("이메일")).toHaveAccessibleDescription(
      "이메일 형식이 올바르지 않아요.",
    );
    expect(screen.getByLabelText("비밀번호")).toHaveAccessibleDescription(
      "비밀번호는 8자 이상이어야 해요.",
    );
    expect(screen.getByLabelText("비밀번호 확인")).toHaveAccessibleDescription(
      "비밀번호가 일치하지 않아요.",
    );
  });

  it("액션이 돌려준 폼 전체 오류를 보여준다", async () => {
    vi.mocked(signUp).mockResolvedValue({
      message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
    });
    render(<SignupForm />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
    );
    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
  });

  it("오류가 나도 입력한 이메일은 남긴다", async () => {
    vi.mocked(signUp).mockResolvedValue({
      errors: { passwordConfirm: "비밀번호가 일치하지 않아요." },
    });
    render(<SignupForm />);

    await submit("user@example.com", "password123", "password124");
    await screen.findByText("비밀번호가 일치하지 않아요.");

    expect(screen.getByLabelText("이메일")).toHaveValue("user@example.com");
    expect(screen.getByLabelText("비밀번호")).toHaveValue("");
  });

  it("가입에 성공하면 폼 대신 안내 문구를 보여준다", async () => {
    vi.mocked(signUp).mockResolvedValue({ success: true, message: SENT });
    render(<SignupForm />);

    await submit();

    expect(await screen.findByRole("status")).toHaveTextContent(SENT);
    expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("제출 중에는 버튼을 비활성화한다", async () => {
    let finish!: (state: AuthFormState) => void;
    vi.mocked(signUp).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<SignupForm />);

    await submit();
    const button = screen.getByRole("button");

    expect(button).toBeDisabled();

    await act(async () => finish({}));

    expect(button).toBeEnabled();
  });

  it("로그인으로 가는 링크가 있다", () => {
    render(<SignupForm />);

    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
