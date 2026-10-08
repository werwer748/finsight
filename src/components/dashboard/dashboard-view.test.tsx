import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardView } from "./dashboard-view";

describe("DashboardView", () => {
  it("기간과 props의 합계, 카테고리, 거래를 순서대로 표시한다", () => {
    render(<DashboardView range={{ from: "2026-08-14", to: "2026-09-13" }} summary={{ totalExpense: 12000, totalIncome: 0, totalTransfer: 0, categories: [{ category: "식비", amount: 12000, ratio: 1 }] }} transactions={[]} />);
    expect(screen.getByText("2026.08.14 ~ 2026.09.13")).toBeInTheDocument();
    expect(screen.getByText("최근 1개월")).toBeInTheDocument();
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["총 지출", "총 수입", "카테고리별 지출", "거래 내역"]);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getAllByText("12,000원")).toHaveLength(2);
    expect(screen.queryByText(/더 오래된 내역은 저장만/)).not.toBeInTheDocument();
  });
});
