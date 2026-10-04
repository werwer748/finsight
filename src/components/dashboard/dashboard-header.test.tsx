import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { signOut } from "@/lib/auth/actions";

vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
});

describe("DashboardHeader", () => {
  it("서비스 이름은 대시보드로 가는 링크다", () => {
    render(<DashboardHeader email="user@example.com" />);

    expect(screen.getByRole("link", { name: "FinSight" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("사용자 이메일을 보여준다", () => {
    render(<DashboardHeader email="user@example.com" />);

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("로그아웃 버튼을 보여준다", () => {
    render(<DashboardHeader email="user@example.com" />);

    expect(screen.getByRole("button", { name: "로그아웃" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("로그아웃 버튼을 누르면 signOut 액션을 호출한다", async () => {
    const user = userEvent.setup();
    render(<DashboardHeader email="user@example.com" />);

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
