// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withFingerprints } from "./fingerprint";
import type { CategorizedTransaction } from "@/types/transaction";

const transaction: CategorizedTransaction = {
  date: "2026-09-13", time: "09:05", merchant: "가게", amount: 12000,
  kind: "expense", category: "식비",
};
const fingerprint = (value: CategorizedTransaction) => withFingerprints([value])[0].fingerprint;

describe("withFingerprints", () => {
  it("정해진 배열의 SHA-256 지문을 재현하며 원본과 순서를 보존한다", () => {
    const input = [transaction, { ...transaction, merchant: "다른 가게" }, transaction];
    const result = withFingerprints(input);
    expect(result.map(({ fingerprint }) => fingerprint)).toEqual(withFingerprints(input).map(({ fingerprint }) => fingerprint));
    expect(result[0].fingerprint).toBe(createHash("sha256").update(JSON.stringify([
      transaction.date, transaction.time, transaction.merchant, transaction.amount, transaction.kind, 0,
    ])).digest("hex"));
    expect(result[0].fingerprint).not.toBe(result[2].fingerprint);
    result.forEach((value, index) => expect(value).toEqual({ ...input[index], fingerprint: expect.any(String) }));
    expect(transaction).not.toHaveProperty("fingerprint");
    expect(withFingerprints([])).toEqual([]);
  });

  it("category는 지문에 영향을 주지 않는다", () => {
    expect(fingerprint({ ...transaction, category: "기타" })).toBe(fingerprint(transaction));
  });

  it.each([
    { date: "2026-09-14" }, { time: "18:30" }, { merchant: "다른 가게" },
    { amount: 12001 }, { kind: "income" as const },
  ])("각 식별 값이 달라지면 지문이 다르다: %j", (change) => {
    expect(fingerprint({ ...transaction, ...change })).not.toBe(fingerprint(transaction));
  });

  it("시각이 다르면 발생 횟수를 따로 센다", () => {
    const later = { ...transaction, time: "18:30" };
    expect(withFingerprints([transaction, later]).map(({ fingerprint }) => fingerprint))
      .toEqual([fingerprint(transaction), fingerprint(later)]);
  });

  it("null 시각을 그대로 해시하고 같은 null 거래도 구분한다", () => {
    const absent = { ...transaction, time: null };
    const result = withFingerprints([absent, absent]);
    expect(result[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result[0].fingerprint).not.toBe(fingerprint(transaction));
    expect(result[0].fingerprint).not.toBe(result[1].fingerprint);
    expect(result[0].fingerprint).toBe(createHash("sha256").update(JSON.stringify([
      absent.date, null, absent.merchant, absent.amount, absent.kind, 0,
    ])).digest("hex"));
  });
});
