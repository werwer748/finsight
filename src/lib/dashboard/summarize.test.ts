// @vitest-environment node
import { describe, expect, it } from "vitest";
import { INCOME_CATEGORY, MERCHANT_CATEGORIES, TRANSFER_CATEGORY } from "@/lib/transactions/categories";
import type { CategorizedTransaction } from "@/types/transaction";
import { summarize } from "./summarize";

type SummaryTransaction = Pick<CategorizedTransaction, "amount" | "kind" | "category">;

describe("summarize", () => {
  it("지출과 수입을 각각 정수로 합하고 수입은 카테고리에서 제외한다", () => {
    const result = summarize([
      { amount: 1234, kind: "expense", category: "식비" },
      { amount: 4567, kind: "expense", category: "쇼핑" },
      { amount: 3000000, kind: "income", category: INCOME_CATEGORY },
      { amount: 1000, kind: "income", category: INCOME_CATEGORY },
    ]);
    expect(result.totalExpense).toBe(5801);
    expect(result.totalIncome).toBe(3001000);
    expect(result.totalTransfer).toBe(0);
    expect(result.categories.map(({ category }) => category)).toEqual(["쇼핑", "식비"]);
  });

  it("이체는 별도로 합하고 총 지출과 카테고리에서 제외한다", () => {
    expect(summarize([
      { amount: 10000, kind: "expense", category: "식비" },
      { amount: 20000, kind: "expense", category: TRANSFER_CATEGORY },
      { amount: 30000, kind: "expense", category: TRANSFER_CATEGORY },
    ])).toEqual({
      totalExpense: 10000, totalIncome: 0, totalTransfer: 50000,
      categories: [{ category: "식비", amount: 10000, ratio: 1 }],
    });
  });

  it("환불은 총 지출과 해당 카테고리 금액을 줄인다", () => {
    expect(summarize([
      { amount: 10000, kind: "expense", category: "식비" },
      { amount: -4500, kind: "expense", category: "식비" },
    ])).toEqual({
      totalExpense: 5500, totalIncome: 0, totalTransfer: 0,
      categories: [{ category: "식비", amount: 5500, ratio: 1 }],
    });
  });

  it("합이 0 이하인 카테고리를 빼고 남은 양수 금액으로 비율을 계산한다", () => {
    const result = summarize([
      { amount: 5000, kind: "expense", category: "식비" },
      { amount: -5000, kind: "expense", category: "식비" },
      { amount: -1000, kind: "expense", category: "쇼핑" },
      { amount: 3000, kind: "expense", category: "교통·차량" },
    ]);
    expect(result.totalExpense).toBe(2000);
    expect(result.categories).toEqual([{ category: "교통·차량", amount: 3000, ratio: 1 }]);
  });

  it("양수 카테고리가 없으면 비율 계산 없이 빈 배열을 반환한다", () => {
    expect(summarize([{ amount: -1000, kind: "expense", category: "식비" }])).toEqual({
      totalExpense: -1000, totalIncome: 0, totalTransfer: 0, categories: [],
    });
  });

  it("금액 내림차순으로 정렬하고 동률은 가맹점 카테고리 순서를 따른다", () => {
    const transactions: SummaryTransaction[] = [...MERCHANT_CATEGORIES].reverse().map((category) => ({
      amount: category === "쇼핑" ? 2000 : 1000, kind: "expense", category,
    }));
    const result = summarize(transactions);
    expect(result.categories.map(({ category }) => category)).toEqual([
      "쇼핑", ...MERCHANT_CATEGORIES.filter((category) => category !== "쇼핑"),
    ]);
    expect(result.categories[0].ratio).toBeCloseTo(2000 / 13000);
    expect(result.categories.reduce((sum, { ratio }) => sum + ratio, 0)).toBeCloseTo(1);
  });

  it("읽기 전용 입력을 바꾸지 않는다", () => {
    const transactions = Object.freeze([
      Object.freeze({ amount: 1000, kind: "expense", category: "식비" } as const),
    ]);
    expect(summarize(transactions).totalExpense).toBe(1000);
    expect(transactions).toEqual([{ amount: 1000, kind: "expense", category: "식비" }]);
  });

  it("빈 입력은 모든 합계가 0이고 카테고리가 없다", () => {
    expect(summarize([])).toEqual({ totalExpense: 0, totalIncome: 0, totalTransfer: 0, categories: [] });
  });
});
