// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatDate, formatWon } from "./format";

describe("formatWon", () => {
  it.each([[1234000, "1,234,000원"], [-4500, "-4,500원"], [0, "0원"]])(
    "%s원을 %s으로 표기한다", (amount, expected) => {
      expect(formatWon(amount as number)).toBe(expected);
    },
  );
});

describe("formatDate", () => {
  it("날짜 문자열의 두 자리 월과 일을 유지한다", () => {
    expect(formatDate("2026-09-01")).toBe("2026.09.01");
  });
});
