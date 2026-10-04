import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "@/components/landing/hero";

describe("Hero", () => {
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
