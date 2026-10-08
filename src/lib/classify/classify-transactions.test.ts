// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MerchantCategory, ParsedTransaction } from "@/types/transaction";
import { classifyTransactions, type ClassifyDeps } from "./classify-transactions";

function transaction(merchant: string, overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return { date: "2026-09-13", time: null, merchant, amount: 5000, kind: "expense", isTransfer: false, ...overrides };
}

function dependencies() {
  return {
    loadCache: vi.fn<ClassifyDeps["loadCache"]>().mockResolvedValue(new Map()),
    classify: vi.fn<ClassifyDeps["classify"]>().mockResolvedValue(new Map()),
    saveCache: vi.fn<ClassifyDeps["saveCache"]>().mockResolvedValue(undefined),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("classifyTransactions", () => {
  it("입금·이체의 원문과 키는 분류 및 캐시 저장 인자에 나타나지 않는다", async () => {
    const deps = dependencies();
    deps.classify.mockResolvedValue(new Map([["쿠팡 *", "쇼핑"]]));
    const result = await classifyTransactions([
      transaction("  홍길동 1234567890  ", { kind: "income", isTransfer: true }),
      transaction("  김철수 110-123-456789  ", { isTransfer: true }),
      transaction("쿠팡 1234567890"),
    ], deps);
    expect(result.transactions.map((row) => row.category)).toEqual(["수입", "이체", "쇼핑"]);
    expect(deps.classify.mock.calls).toEqual([[["쿠팡 *"]]]);
    expect(deps.saveCache.mock.calls).toEqual([[new Map([["쿠팡 *", "쇼핑"]])]]);
    const outgoing = JSON.stringify({ classify: deps.classify.mock.calls, saveCache: deps.saveCache.mock.calls.map(([entries]) => [...entries]) });
    for (const forbidden of ["홍길동", "김철수", "1234567890", "110-123-456789"]) {
      expect(outgoing).not.toContain(forbidden);
    }
    expect(result.unclassified).toBe(0);
  });

  it("마스킹한 키 문자열만 최초 등장 순서로 중복 없이 한 번 분류한다", async () => {
    const deps = dependencies();
    await classifyTransactions([
      transaction("쿠팡 1234567890"), transaction("  스타벅스   강남점 "),
      transaction("쿠팡 9876543210"), transaction("스타벅스 강남점"),
    ], deps);
    expect(deps.classify.mock.calls).toEqual([[["쿠팡 *", "스타벅스 강남점"]]]);
    for (const key of deps.classify.mock.calls[0][0]) {
      for (const segment of key.match(/[\d-]+/g) ?? []) {
        expect(segment.replace(/-/g, "").length).toBeLessThan(4);
      }
    }
  });

  it("캐시의 가맹점은 재분류하거나 다시 저장하지 않는다", async () => {
    const deps = dependencies();
    deps.loadCache.mockResolvedValue(new Map([["쿠팡 *", "쇼핑"]]));
    const result = await classifyTransactions([transaction("쿠팡 1234567890")], deps);
    expect(result.transactions[0].category).toBe("쇼핑");
    expect(result.unclassified).toBe(0);
    expect(deps.loadCache).toHaveBeenCalledTimes(1);
    expect(deps.classify).not.toHaveBeenCalled();
    expect(deps.saveCache).not.toHaveBeenCalled();
  });

  it("일부 응답만 저장하고 미분류 건수는 키 수가 아닌 거래 수로 센다", async () => {
    const deps = dependencies();
    deps.classify.mockResolvedValue(new Map([["카페", "카페·간식"]]));
    const result = await classifyTransactions([transaction("카페"), transaction("매장"), transaction("매장")], deps);
    expect(result.transactions.map((row) => row.category)).toEqual(["카페·간식", "기타", "기타"]);
    expect(result.unclassified).toBe(2);
    expect(deps.saveCache.mock.calls).toEqual([[new Map([["카페", "카페·간식"]])]]);
  });

  it("분류 예외는 개인정보 없이 기록하고 기타로 계속 진행한다", async () => {
    const deps = dependencies();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.classify.mockRejectedValue(new Error("비밀가게 1234567890 비밀가게 *"));
    const result = await classifyTransactions([transaction("비밀가게 1234567890"), transaction("비밀가게 1234567890")], deps);
    expect(result.transactions.map((row) => row.category)).toEqual(["기타", "기타"]);
    expect(result.unclassified).toBe(2);
    expect(deps.saveCache).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/비밀가게|1234567890/);
  });

  it("캐시·분류 결과의 기타 및 빈 키는 미분류 건수에서 제외한다", async () => {
    const deps = dependencies();
    deps.loadCache.mockResolvedValue(new Map([["기존매장", "기타"]]));
    deps.classify.mockResolvedValue(new Map([["새매장", "기타"]]));
    const result = await classifyTransactions([transaction("기존매장"), transaction("새매장"), transaction(" \t ")], deps);
    expect(result.transactions.map((row) => row.category)).toEqual(["기타", "기타", "기타"]);
    expect(result.unclassified).toBe(0);
    expect(deps.classify.mock.calls).toEqual([[["새매장"]]]);
    expect(deps.saveCache.mock.calls).toEqual([[new Map([["새매장", "기타"]])]]);
  });

  it("요청하지 않은 키와 유효하지 않은 카테고리는 버린다", async () => {
    const deps = dependencies();
    const response = new Map<string, unknown>([["가게", "식비"], ["없는키", "쇼핑"], ["잘못된가게", "없는 카테고리"], ["이체가게", "이체"], ["수입가게", "수입"], ["숫자가게", 123]]);
    deps.classify.mockResolvedValue(response as Map<string, MerchantCategory>);
    const result = await classifyTransactions(["가게", "잘못된가게", "이체가게", "수입가게", "숫자가게"].map((name) => transaction(name)), deps);
    expect(result.transactions.map((row) => row.category)).toEqual(["식비", "기타", "기타", "기타", "기타"]);
    expect(result.unclassified).toBe(4);
    expect(deps.saveCache.mock.calls).toEqual([[new Map([["가게", "식비"]])]]);
  });

  it("유효한 응답이 없으면 캐시를 저장하지 않는다", async () => {
    const deps = dependencies();
    deps.classify.mockResolvedValue(new Map([["요청하지않은키", "쇼핑"]]));
    const result = await classifyTransactions([transaction("가게")], deps);
    expect(result.unclassified).toBe(1);
    expect(deps.saveCache).not.toHaveBeenCalled();
  });

  it("캐시 조회 예외는 그대로 전파한다", async () => {
    const deps = dependencies();
    const error = new Error("캐시 조회 실패");
    deps.loadCache.mockRejectedValue(error);
    await expect(classifyTransactions([transaction("가게")], deps)).rejects.toBe(error);
    expect(deps.classify).not.toHaveBeenCalled();
    expect(deps.saveCache).not.toHaveBeenCalled();
  });

  it("캐시 저장 예외는 그대로 전파한다", async () => {
    const deps = dependencies();
    const error = new Error("캐시 저장 실패");
    deps.classify.mockResolvedValue(new Map([["가게", "식비"]]));
    deps.saveCache.mockRejectedValue(error);
    await expect(classifyTransactions([transaction("가게")], deps)).rejects.toBe(error);
  });

  it.each([
    { input: [] },
    { input: [transaction("홍길동", { kind: "income", isTransfer: false }), transaction("김철수", { isTransfer: true })] },
    { input: [transaction(" \t ")] },
  ])("분류 대상이 없으면 의존성을 호출하지 않는다: $input", async ({ input }) => {
    const deps = dependencies();
    const result = await classifyTransactions(input, deps);
    expect(result.transactions).toHaveLength(input.length);
    expect(result.unclassified).toBe(0);
    expect(deps.loadCache).not.toHaveBeenCalled();
    expect(deps.classify).not.toHaveBeenCalled();
    expect(deps.saveCache).not.toHaveBeenCalled();
  });

  it("입력 길이·순서·원문·시각을 유지하고 isTransfer 없이 반환하며 입력을 변경하지 않는다", async () => {
    const deps = dependencies();
    deps.loadCache.mockResolvedValue(new Map([["가게 *", "식비"]]));
    const input = [transaction("  가게 1234 ", { time: "14:30", amount: -5000 }), transaction("홍길동", { kind: "income" }), transaction("김철수", { time: "09:05", isTransfer: true })];
    const snapshot = structuredClone(input);
    const result = await classifyTransactions(input, deps);
    expect(result.transactions).toEqual(input.map(({ date, time, merchant, amount, kind }, index) => ({ date, time, merchant, amount, kind, category: ["식비", "수입", "이체"][index] })));
    for (const row of result.transactions) expect(row).not.toHaveProperty("isTransfer");
    expect(input).toEqual(snapshot);
    expect(result.unclassified).toBe(0);
  });
});
