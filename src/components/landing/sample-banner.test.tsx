import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SampleBanner } from "./sample-banner";

describe("SampleBanner", () => {
  it("가상 데이터 안내와 가입 링크를 보여준다", () => {
    render(<SampleBanner />);
    expect(screen.getByText("가상 데이터로 만든 샘플 화면이에요. 내 거래 내역으로 보려면 가입해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "무료로 시작하기" })).toHaveAttribute("href", "/signup");
  });
});
