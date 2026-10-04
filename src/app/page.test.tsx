import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("홈 페이지", () => {
  it("서비스 이름 FinSight를 제목으로 보여준다", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "FinSight" }),
    ).toBeInTheDocument();
  });
});
