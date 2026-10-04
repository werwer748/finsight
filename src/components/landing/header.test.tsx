import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingHeader } from "@/components/landing/header";

describe("LandingHeader", () => {
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
