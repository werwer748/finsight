import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "@/components/dashboard/empty-state";

describe("EmptyState", () => {
  it("제목을 보여준다", () => {
    render(<EmptyState />);

    expect(
      screen.getByRole("heading", { name: "아직 분석한 내역이 없어요" }),
    ).toBeInTheDocument();
  });

  it("설명을 보여준다", () => {
    render(<EmptyState />);

    expect(
      screen.getByText(
        "거래 내역 파일을 올리면 여기에서 소비 분석을 볼 수 있어요.",
      ),
    ).toBeInTheDocument();
  });
});
