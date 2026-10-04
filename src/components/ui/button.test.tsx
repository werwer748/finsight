import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "@/components/ui/button";

describe("Button", () => {
  it("클릭하면 onClick을 호출한다", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>저장</Button>);

    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled이면 클릭해도 onClick을 호출하지 않는다", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        저장
      </Button>,
    );
    const button = screen.getByRole("button", { name: "저장" });

    await user.click(button);

    expect(button).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("type 같은 버튼 속성을 그대로 전달한다", () => {
    render(
      <Button type="submit" name="intent" value="save">
        저장
      </Button>,
    );
    const button = screen.getByRole("button", { name: "저장" });

    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("name", "intent");
    expect(button).toHaveAttribute("value", "save");
  });
});

describe("ButtonLink", () => {
  it("주어진 href를 가진 링크로 렌더링한다", () => {
    render(<ButtonLink href="/signup">무료로 시작하기</ButtonLink>);

    expect(
      screen.getByRole("link", { name: "무료로 시작하기" }),
    ).toHaveAttribute("href", "/signup");
  });
});
