// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toMerchantKey } from "./merchant-key";

describe("toMerchantKey", () => {
  it.each([
    ["  스타벅스   강남점 ", "스타벅스 강남점"],
    ["쿠팡 1234567890", "쿠팡 *"],
    ["110-123-456789 홍길동", "* 홍길동"],
    ["스타벅스 1234점", "스타벅스 *점"],
    ["GS25 역삼점", "GS25 역삼점"],
    ["24시 마트 123호", "24시 마트 123호"],
    ["", ""],
    [" \t\n ", ""],
    ["매장\t 강남\n점", "매장 강남 점"],
    ["가게 -12-34- / 123- / 5678", "가게 * / 123- / *"],
    ["12-3 가게 1-2-3-4", "12-3 가게 *"],
  ])("%j를 %j로 정규화한다", (input, expected) => {
    expect(toMerchantKey(input)).toBe(expected);
  });
});
