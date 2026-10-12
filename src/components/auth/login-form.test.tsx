import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import posthog from "posthog-js";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";
import { signIn } from "@/lib/auth/actions";
import type { AuthFormState } from "@/types/auth";

// 설정 여부는 컴포넌트 모듈을 불러올 때 한 번 읽으므로 import보다 먼저 넣는다.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://posthog.example");
});
vi.mock("@/lib/auth/actions", () => ({ signIn: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

async function submit(email = "user@example.com", password = "password123") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("이메일"), email);
  await user.type(screen.getByLabelText("비밀번호"), password);
  await user.click(screen.getByRole("button", { name: "로그인" }));
}

beforeEach(() => {
  vi.mocked(signIn).mockResolvedValue({});
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("LoginForm", () => {
  it("제출하면 login_submitted 이벤트를 PostHog에 보낸다", async () => {
    render(<LoginForm />);

    await submit();

    expect(posthog.capture).toHaveBeenCalledWith("login_submitted");
    expect(posthog.capture).toHaveBeenCalledTimes(1);
  });

  it("액션이 필드별 오류를 돌려주면 login_failed 이벤트를 검증 실패로 보낸다", async () => {
    vi.mocked(signIn).mockResolvedValue({
      errors: { email: "이메일 형식이 올바르지 않아요." },
    });
    render(<LoginForm />);

    await submit("user");
    await screen.findByText("이메일 형식이 올바르지 않아요.");

    expect(posthog.capture).toHaveBeenCalledWith("login_failed", {
      reason: "validation",
    });
    expect(posthog.capture).toHaveBeenCalledTimes(2);
  });

  it("액션이 폼 전체 오류를 돌려주면 login_failed 이벤트를 서버 거절로 보낸다", async () => {
    vi.mocked(signIn).mockResolvedValue({
      message: "이메일 또는 비밀번호가 올바르지 않아요.",
    });
    render(<LoginForm />);

    await submit();
    await screen.findByRole("alert");

    expect(posthog.capture).toHaveBeenCalledWith("login_failed", {
      reason: "server",
    });
    expect(posthog.capture).toHaveBeenCalledTimes(2);
  });

  it("같은 오류로 두 번 실패하면 login_failed 이벤트도 두 번 보낸다", async () => {
    vi.mocked(signIn).mockImplementation(async () => ({
      message: "이메일 또는 비밀번호가 올바르지 않아요.",
    }));
    render(<LoginForm />);

    await submit();
    await screen.findByRole("alert");
    await userEvent.setup().type(screen.getByLabelText("비밀번호"), "password124");
    await userEvent.setup().click(screen.getByRole("button", { name: "로그인" }));
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "로그인" })).toBeEnabled(),
    );

    expect(
      vi.mocked(posthog.capture).mock.calls.filter(
        ([event]) => event === "login_failed",
      ),
    ).toHaveLength(2);
  });

  it("StrictMode에서도 결과 이벤트는 제출 한 번에 한 번만 보낸다", async () => {
    vi.mocked(signIn).mockResolvedValue({
      message: "이메일 또는 비밀번호가 올바르지 않아요.",
    });
    render(
      <StrictMode>
        <LoginForm />
      </StrictMode>,
    );

    expect(posthog.capture).not.toHaveBeenCalled();

    await submit();
    await screen.findByRole("alert");

    expect(
      vi.mocked(posthog.capture).mock.calls.filter(
        ([event]) => event === "login_failed",
      ),
    ).toHaveLength(1);
  });

  it("이메일 확인 실패 안내만 보여줄 때는 login_failed 이벤트를 보내지 않는다", () => {
    render(<LoginForm notice="confirm-failed" />);

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("이메일과 비밀번호 입력을 라벨로 찾을 수 있다", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("이메일")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("제출하면 입력값을 서버 액션에 넘긴다", async () => {
    render(<LoginForm />);

    await submit();

    const formData = vi.mocked(signIn).mock.calls[0][1];
    expect(formData.get("email")).toBe("user@example.com");
    expect(formData.get("password")).toBe("password123");
  });

  it("액션이 돌려준 필드별 오류를 입력 아래에 보여준다", async () => {
    vi.mocked(signIn).mockResolvedValue({
      errors: {
        email: "이메일 형식이 올바르지 않아요.",
        password: "비밀번호는 8자 이상이어야 해요.",
      },
    });
    render(<LoginForm />);

    await submit("user", "1234567");

    expect(await screen.findByLabelText("이메일")).toHaveAccessibleDescription(
      "이메일 형식이 올바르지 않아요.",
    );
    expect(screen.getByLabelText("비밀번호")).toHaveAccessibleDescription(
      "비밀번호는 8자 이상이어야 해요.",
    );
  });

  it("액션이 돌려준 폼 전체 오류를 보여준다", async () => {
    vi.mocked(signIn).mockResolvedValue({
      message: "이메일 또는 비밀번호가 올바르지 않아요.",
    });
    render(<LoginForm />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이메일 또는 비밀번호가 올바르지 않아요.",
    );
  });

  it("오류가 나도 입력한 이메일은 남긴다", async () => {
    vi.mocked(signIn).mockResolvedValue({
      message: "이메일 또는 비밀번호가 올바르지 않아요.",
    });
    render(<LoginForm />);

    await submit();
    await screen.findByRole("alert");

    expect(screen.getByLabelText("이메일")).toHaveValue("user@example.com");
    expect(screen.getByLabelText("비밀번호")).toHaveValue("");
  });

  it("제출 중에는 버튼을 비활성화한다", async () => {
    let finish!: (state: AuthFormState) => void;
    vi.mocked(signIn).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<LoginForm />);

    await submit();
    const button = screen.getByRole("button");

    expect(button).toBeDisabled();

    await act(async () => finish({}));

    expect(button).toBeEnabled();
  });

  it("notice가 confirm-failed면 이메일 확인 실패 안내를 보여준다", () => {
    render(<LoginForm notice="confirm-failed" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "이메일 확인을 마치지 못했어요. 로그인해서 다시 시도해 주세요.",
    );
  });

  it("notice가 없거나 모르는 값이면 안내를 보여주지 않는다", () => {
    const { rerender } = render(<LoginForm />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<LoginForm notice="unknown" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("회원가입으로 가는 링크가 있다", () => {
    render(<LoginForm />);

    expect(screen.getByRole("link", { name: "회원가입" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });
});
