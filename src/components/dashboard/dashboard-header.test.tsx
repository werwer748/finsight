import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import posthog from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { signOut } from "@/lib/auth/actions";

// 설정 여부는 컴포넌트 모듈을 불러올 때 한 번 읽으므로 import보다 먼저 넣는다.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://posthog.example");
});
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("posthog-js", () => ({
  default: { identify: vi.fn(), capture: vi.fn(), reset: vi.fn() },
}));

afterEach(() => {
  vi.resetAllMocks();
});

describe("DashboardHeader", () => {
  it("서비스 이름은 대시보드로 가는 링크다", () => {
    render(<DashboardHeader email="user@example.com" userId="user-1" />);

    expect(screen.getByRole("link", { name: "FinSight" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("사용자 이메일을 보여준다", () => {
    render(<DashboardHeader email="user@example.com" userId="user-1" />);

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("로그아웃 버튼을 보여준다", () => {
    render(<DashboardHeader email="user@example.com" userId="user-1" />);

    expect(screen.getByRole("button", { name: "로그아웃" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("로그아웃 버튼을 누르면 signOut 액션을 호출한다", async () => {
    const user = userEvent.setup();
    render(<DashboardHeader email="user@example.com" userId="user-1" />);

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("사용자 ID만으로 PostHog에 식별하고 이메일은 보내지 않는다", () => {
    render(<DashboardHeader email="user@example.com" userId="user-1" />);

    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledWith("user-1");
  });

  it("로그아웃 버튼을 누르면 logout_submitted 이벤트를 보내고 PostHog의 사용자 식별을 지운다", async () => {
    const user = userEvent.setup();
    render(<DashboardHeader email="user@example.com" userId="user-1" />);

    await user.click(screen.getByRole("button", { name: "로그아웃" }));

    expect(posthog.capture).toHaveBeenCalledWith("logout_submitted");
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});
