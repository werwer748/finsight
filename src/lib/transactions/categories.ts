import type { MerchantCategory } from "@/types/transaction";

// Claude가 고를 수 있는 카테고리. 순서는 화면 정렬의 동률 기준이다.
export const MERCHANT_CATEGORIES = [
  "식비",
  "카페·간식",
  "마트·편의점",
  "쇼핑",
  "교통·차량",
  "주거·통신",
  "의료·건강",
  "문화·여가",
  "여행·숙박",
  "교육",
  "금융·보험",
  "기타",
] as const;

// 코드가 직접 붙이는 카테고리. Claude는 이 값을 고르지 않는다.
export const TRANSFER_CATEGORY = "이체"; // 은행 내역에서 카드 결제로 확인되지 않은 출금
export const INCOME_CATEGORY = "수입"; // kind가 income인 모든 거래
export const FALLBACK_CATEGORY = "기타"; // 분류하지 못한 출금

export function isMerchantCategory(value: unknown): value is MerchantCategory {
  return MERCHANT_CATEGORIES.some((category) => category === value);
}
