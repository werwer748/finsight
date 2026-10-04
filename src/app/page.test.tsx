import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("홈 페이지", () => {
  it("히어로 제목을 페이지의 유일한 h1으로 보여준다", () => {
    render(<Home />);

    // getByRole은 h1이 둘 이상이면 실패한다.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "거래 내역 파일만 올리면, 소비가 한눈에",
    );
  });

  it("헤더와 푸터를 함께 보여준다", () => {
    render(<Home />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
