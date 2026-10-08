// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  FALLBACK_CATEGORY,
  INCOME_CATEGORY,
  MERCHANT_CATEGORIES,
  TRANSFER_CATEGORY,
  isMerchantCategory,
} from "@/lib/transactions/categories";

describe("거래 카테고리", () => {
  it("가맹점 카테고리는 중복 없이 12개다", () => {
    expect(MERCHANT_CATEGORIES).toHaveLength(12);
    expect(new Set(MERCHANT_CATEGORIES).size).toBe(12);
  });

  it("분류하지 못한 거래의 카테고리는 가맹점 목록에 있다", () => {
    expect(MERCHANT_CATEGORIES).toContain(FALLBACK_CATEGORY);
  });

  it("이체와 수입은 가맹점 목록에 없다", () => {
    expect(MERCHANT_CATEGORIES).not.toContain(TRANSFER_CATEGORY);
    expect(MERCHANT_CATEGORIES).not.toContain(INCOME_CATEGORY);
  });
});

describe("isMerchantCategory", () => {
  it("목록의 모든 값을 가맹점 카테고리로 판별한다", () => {
    for (const category of MERCHANT_CATEGORIES) {
      expect(isMerchantCategory(category)).toBe(true);
    }
  });

  it.each(["이체", "수입", "", undefined, 123, "없는 카테고리", null, {}, []])(
    "가맹점 카테고리가 아닌 값(%s)은 false다",
    (value) => {
      expect(isMerchantCategory(value)).toBe(false);
    },
  );
});
