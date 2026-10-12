import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import posthog from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/landing/hero";

// 설정 여부는 컴포넌트 모듈을 불러올 때 한 번 읽으므로 import보다 먼저 넣는다.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://posthog.example");
});
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

afterEach(() => {
  vi.resetAllMocks();
});

describe("Hero", () => {
  it("샘플 먼저 보기 링크는 /sample로 간다", () => {
    render(<Hero />);
    expect(screen.getByRole("link", { name: "샘플 먼저 보기" })).toHaveAttribute("href", "/sample");
  });

  it.each([
    ["무료로 시작하기", "signup"],
    ["로그인", "login"],
  ])(
    "%s 링크를 누르면 landing_cta_clicked 이벤트를 PostHog에 보낸다",
    async (name, cta) => {
      render(<Hero />);

      await userEvent.setup().click(screen.getByRole("link", { name }));

      expect(posthog.capture).toHaveBeenCalledTimes(1);
      expect(posthog.capture).toHaveBeenCalledWith("landing_cta_clicked", {
        cta,
        location: "hero",
      });
    },
  );

  it("제목과 설명을 보여준다", () => {
    render(<Hero />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "거래 내역 파일만 올리면, 소비가 한눈에",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "은행·카드사에서 내려받은 CSV, Excel 파일을 올리면 자동으로 분류해 대시보드로 보여드려요.",
      ),
    ).toBeInTheDocument();
  });

  it("무료로 시작하기 버튼은 /signup 으로 간다", () => {
    render(<Hero />);

    expect(
      screen.getByRole("link", { name: "무료로 시작하기" }),
    ).toHaveAttribute("href", "/signup");
  });

  it("이미 계정이 있는 사용자를 위한 로그인 링크는 /login 으로 간다", () => {
    render(<Hero />);

    expect(screen.getByText("이미 계정이 있나요?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
