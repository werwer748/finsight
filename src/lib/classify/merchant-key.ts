// 캐시와 분류 요청에는 원문 대신 이 키만 사용한다.
export function toMerchantKey(merchant: string): string {
  return merchant.trim().replace(/\s+/g, " ").replace(/[\d-]+/g, (segment) => {
    const digits = segment.replace(/-/g, "");
    return digits.length >= 4 ? "*" : segment;
  });
}
