import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import posthog from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalError from "@/app/global-error";

// 설정 여부는 컴포넌트 모듈을 불러올 때 한 번 읽으므로 import보다 먼저 넣는다.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://posthog.example");
});
vi.mock("posthog-js", () => ({ default: { captureException: vi.fn() } }));

afterEach(() => {
  vi.resetAllMocks();
});

describe("전역 오류 화면", () => {
  it("무슨 일이 있었는지와 다시 할 방법을 한국어로 보여준다", () => {
    render(<GlobalError error={new Error("boom")} retry={vi.fn()} />);

    expect(document.documentElement).toHaveAttribute("lang", "ko");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "문제가 생겼어요",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "화면을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("다시 시도를 누르면 retry를 부른다", async () => {
    const retry = vi.fn();
    render(<GlobalError error={new Error("boom")} retry={retry} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "다시 시도" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("오류를 PostHog에 보낸다", () => {
    const error = new Error("boom");
    render(<GlobalError error={error} retry={vi.fn()} />);

    expect(posthog.captureException).toHaveBeenCalledTimes(1);
    expect(vi.mocked(posthog.captureException).mock.calls[0][0]).toBe(error);
  });

  it("서버에서 난 오류는 서버 로그와 맞춰 볼 수 있게 digest를 함께 보낸다", () => {
    const error = Object.assign(new Error("boom"), { digest: "1234567890" });
    render(<GlobalError error={error} retry={vi.fn()} />);

    expect(posthog.captureException).toHaveBeenCalledWith(error, {
      error_digest: "1234567890",
    });
  });
});
