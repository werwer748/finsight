import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransactionTable } from "./transaction-table";

describe("TransactionTable", () => {
  it("빈 거래 목록은 0건과 열 제목만 보여준다", () => {
    render(<TransactionTable transactions={[]} />);
    expect(screen.getByText("0건")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(1);
    expect(screen.queryByRole("cell")).not.toBeInTheDocument();
  });
  it("음수 수입은 부호를 중복해서 표시하지 않는다", () => {
    render(<TransactionTable transactions={[
      { id: "1", date: "2026-09-13", merchant: "입금 정정", amount: -5000, kind: "income", category: "수입" },
    ]} />);
    expect(screen.getByRole("cell", { name: "-5,000원" })).toBeInTheDocument();
  });
  it("열 제목, 건수, 날짜, 수입 부호와 빈 내용을 표시하고 받은 순서를 유지한다", () => {
    render(<TransactionTable transactions={[
      { id: "1", date: "2026-09-13", merchant: "", amount: 3000000, kind: "income", category: "수입" },
      { id: "2", date: "2026-08-14", merchant: "식당", amount: 12000, kind: "expense", category: "식비" },
      { id: "3", date: "2026-08-14", merchant: "환불", amount: -5000, kind: "expense", category: "식비" },
    ]} />);
    expect(screen.getByRole("heading", { name: "거래 내역", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("3건")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["날짜", "내용", "카테고리", "금액"]);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("cell", { name: "2026.09.13" })).toBeInTheDocument();
    expect(within(rows[0]).getByRole("cell", { name: "-" })).toBeInTheDocument();
    expect(within(rows[0]).getByRole("cell", { name: "+3,000,000원" })).toHaveClass("text-right", "tabular-nums");
    expect(within(rows[1]).getByRole("cell", { name: "12,000원" })).toBeInTheDocument();
    expect(within(rows[2]).getByRole("cell", { name: "-5,000원" })).toBeInTheDocument();
  });
});
