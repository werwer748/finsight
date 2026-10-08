import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummaryCards } from "./summary-cards";

const explanation = "카드 결제가 아닌 계좌 출금이에요. 총 지출에는 넣지 않았어요.";
describe("SummaryCards", () => {
  it("지출과 수입을 원화로 보여준다", () => {
    render(<SummaryCards totalExpense={1234000} totalIncome={3000000} totalTransfer={0} />);
    expect(screen.getByRole("heading", { name: "총 지출", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "총 수입", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("1,234,000원")).toHaveClass("text-5xl", "text-foreground");
    expect(screen.getByText("1,234,000원")).not.toHaveClass("tabular-nums");
    expect(screen.getByText("3,000,000원")).toHaveClass("text-2xl");
    expect(screen.queryByRole("heading", { name: "이체" })).not.toBeInTheDocument();
    expect(screen.queryByText(explanation)).not.toBeInTheDocument();
  });
  it("이체가 있으면 별도 합계와 설명을 보여준다", () => {
    render(<SummaryCards totalExpense={0} totalIncome={0} totalTransfer={500000} />);
    expect(screen.getByRole("heading", { name: "이체" })).toBeInTheDocument();
    expect(screen.getByText("500,000원")).toHaveClass("text-2xl");
    expect(screen.getByText(explanation)).toBeInTheDocument();
  });
});
