import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import posthog from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingHeader } from "@/components/landing/header";

// 설정 여부는 컴포넌트 모듈을 불러올 때 한 번 읽으므로 import보다 먼저 넣는다.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://posthog.example");
});
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

afterEach(() => {
  vi.resetAllMocks();
});

describe("LandingHeader", () => {
  it.each([
    ["로그인", "login"],
    ["시작하기", "signup"],
  ])(
    "%s 링크를 누르면 landing_cta_clicked 이벤트를 PostHog에 보낸다",
    async (name, cta) => {
      render(<LandingHeader />);

      await userEvent.setup().click(screen.getByRole("link", { name }));

      expect(posthog.capture).toHaveBeenCalledTimes(1);
      expect(posthog.capture).toHaveBeenCalledWith("landing_cta_clicked", {
        cta,
        location: "header",
      });
    },
  );

  it("서비스 이름 링크는 이벤트를 보내지 않는다", async () => {
    render(<LandingHeader />);

    await userEvent.setup().click(screen.getByRole("link", { name: "FinSight" }));

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("서비스 이름은 홈으로 가는 링크다", () => {
    render(<LandingHeader />);

    expect(screen.getByRole("link", { name: "FinSight" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("로그인 링크는 /login 으로 간다", () => {
    render(<LandingHeader />);

    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("시작하기 버튼은 /signup 으로 간다", () => {
    render(<LandingHeader />);

    expect(screen.getByRole("link", { name: "시작하기" })).toHaveAttribute(
      "href",
      "/signup",
    );
  });
});
