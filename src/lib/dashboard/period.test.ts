// @vitest-environment node
import { describe, expect, it } from "vitest";
import { recentMonthRange } from "./period";

describe("recentMonthRange", () => {
  it.each([
    ["2026-09-13", "2026-08-14"],
    ["2026-01-15", "2025-12-16"],
    ["2026-03-31", "2026-03-01"],
    ["2026-03-30", "2026-03-01"],
    ["2024-03-29", "2024-03-01"],
    ["2026-10-31", "2026-10-01"],
    ["2026-03-01", "2026-02-02"],
  ])("최근 거래일 %s의 한 달 조회 시작일은 %s다", (latestDate, from) => {
    expect(recentMonthRange(latestDate)).toEqual({ from, to: latestDate });
  });
});
