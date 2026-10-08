// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SAMPLE_RANGE, SAMPLE_TRANSACTIONS } from "./transactions";
import { INCOME_CATEGORY, MERCHANT_CATEGORIES, TRANSFER_CATEGORY, isMerchantCategory } from "@/lib/transactions/categories";
import { recentMonthRange } from "@/lib/dashboard/period";
import { summarize } from "@/lib/dashboard/summarize";

describe("샘플 거래 내역", () => {
  it("40~60건이며 sample 접두사의 고유 ID를 가진다", () => {
    expect(SAMPLE_TRANSACTIONS.length).toBeGreaterThanOrEqual(40);
    expect(SAMPLE_TRANSACTIONS.length).toBeLessThanOrEqual(60);
    expect(new Set(SAMPLE_TRANSACTIONS.map(({ id }) => id)).size).toBe(SAMPLE_TRANSACTIONS.length);
    for (const { id } of SAMPLE_TRANSACTIONS) expect(id).toMatch(/^sample-\d+$/);
  });

  it("2026년 9월의 날짜를 내림차순으로 가진다", () => {
    const dates = SAMPLE_TRANSACTIONS.map(({ date }) => date);
    for (const date of dates) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(date >= "2026-09-01" && date <= "2026-09-30").toBe(true);
    }
    expect(dates).toEqual([...dates].sort().reverse());
    expect(dates[0]).toBe("2026-09-30");
  });

  it("정수 금액과 종류에 맞는 허용 카테고리를 가진다", () => {
    const allowed = [...MERCHANT_CATEGORIES, TRANSFER_CATEGORY, INCOME_CATEGORY];
    for (const transaction of SAMPLE_TRANSACTIONS) {
      expect(Number.isInteger(transaction.amount)).toBe(true);
      expect(allowed).toContain(transaction.category);
      if (transaction.kind === "income") expect(transaction.category).toBe(INCOME_CATEGORY);
      else expect(transaction.category).not.toBe(INCOME_CATEGORY);
    }
  });

  it("가맹점 지출 8종류 이상, 수입과 이체 각 1~2건, 환불 1건을 포함한다", () => {
    const expenses = SAMPLE_TRANSACTIONS.filter(({ kind }) => kind === "expense");
    const categories = expenses.map(({ category }) => category).filter(isMerchantCategory);
    expect(new Set(categories).size).toBeGreaterThanOrEqual(8);
    const incomes = SAMPLE_TRANSACTIONS.filter(({ kind }) => kind === "income");
    const transfers = expenses.filter(({ category }) => category === TRANSFER_CATEGORY);
    for (const rows of [incomes, transfers]) {
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.length).toBeLessThanOrEqual(2);
      expect(rows.every(({ amount }) => amount > 0)).toBe(true);
    }
    expect(expenses.filter(({ amount }) => amount < 0)).toHaveLength(1);
  });

  it("가장 최근 날짜로 구한 조회 기간에 모든 거래가 들어간다", () => {
    const latest = SAMPLE_TRANSACTIONS.map(({ date }) => date).sort().at(-1)!;
    expect(SAMPLE_RANGE).toEqual(recentMonthRange(latest));
    expect(SAMPLE_RANGE.to).toBe(latest);
    expect(SAMPLE_TRANSACTIONS.every(({ date }) => date >= SAMPLE_RANGE.from && date <= SAMPLE_RANGE.to)).toBe(true);
  });

  it("코드로 집계한 지출, 수입, 이체가 모두 양수이고 차트가 8개 이상이다", () => {
    const summary = summarize(SAMPLE_TRANSACTIONS);
    expect(summary.totalExpense).toBeGreaterThan(0);
    expect(summary.totalIncome).toBeGreaterThan(0);
    expect(summary.totalTransfer).toBeGreaterThan(0);
    expect(summary.categories.length).toBeGreaterThanOrEqual(8);
  });
});
