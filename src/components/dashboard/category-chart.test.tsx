import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryChart } from "./category-chart";

describe("CategoryChart", () => {
  it("받은 순서와 전체 비율을 표시하고 금액 최댓값으로 막대 길이를 정한다", () => {
    render(<CategoryChart categories={[
      { category: "식비", amount: 60000, ratio: 0.6 },
      { category: "교통·차량", amount: 30000, ratio: 0.3 },
    ]} />);
    expect(screen.getByRole("heading", { name: "카테고리별 지출", level: 2 })).toBeInTheDocument();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    for (const [index, [name, amount, ratio, width]] of [
      ["식비", "60,000원", "60%", "100%"],
      ["교통·차량", "30,000원", "30%", "50%"],
    ].entries()) {
      expect(within(rows[index]).getByText(name)).toBeInTheDocument();
      expect(within(rows[index]).getByText(amount)).toBeInTheDocument();
      expect(within(rows[index]).getByText(ratio)).toBeInTheDocument();
      expect(rows[index].querySelector('[aria-hidden="true"]')).toHaveStyle({ width });
    }
  });
  it("빈 배열이면 지출이 없다고 안내한다", () => {
    render(<CategoryChart categories={[]} />);
    expect(screen.getByText("지출 내역이 없어요.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
