import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("라벨 텍스트로 입력을 찾을 수 있다", () => {
    render(<Input label="이메일" />);

    expect(screen.getByLabelText("이메일")).toBeInTheDocument();
  });

  it("호출부가 id를 주면 그 값을 쓴다", () => {
    render(<Input label="이메일" id="email" />);

    expect(screen.getByLabelText("이메일")).toHaveAttribute("id", "email");
  });

  it("error가 있으면 문구를 보여주고 입력을 오류 상태로 표시한다", () => {
    render(<Input label="이메일" error="이메일 형식이 올바르지 않습니다." />);
    const input = screen.getByLabelText("이메일");

    expect(
      screen.getByText("이메일 형식이 올바르지 않습니다."),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "이메일 형식이 올바르지 않습니다.",
    );
  });

  it("error가 없으면 오류 상태로 표시하지 않는다", () => {
    render(<Input label="이메일" />);
    const input = screen.getByLabelText("이메일");

    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("값을 입력할 수 있다", async () => {
    const user = userEvent.setup();
    render(<Input label="이메일" />);
    const input = screen.getByLabelText("이메일");

    await user.type(input, "user@example.com");

    expect(input).toHaveValue("user@example.com");
  });
});
