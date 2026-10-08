import { recentMonthRange } from "@/lib/dashboard/period";
import { INCOME_CATEGORY, TRANSFER_CATEGORY } from "@/lib/transactions/categories";
import type { DateRange } from "@/types/dashboard";
import type { Transaction } from "@/types/transaction";

// 실제 계정과 무관한 한 사람의 가상 소비 내역. 날짜와 금액은 고정한다.
export const SAMPLE_TRANSACTIONS: Transaction[] = [
  { id: "sample-1", date: "2026-09-30", merchant: "모닝커피 역삼점", amount: 4500, kind: "expense", category: "카페·간식" },
  { id: "sample-2", date: "2026-09-30", merchant: "한끼식당", amount: 11000, kind: "expense", category: "식비" },
  { id: "sample-3", date: "2026-09-29", merchant: "동네바구니 마트", amount: 58300, kind: "expense", category: "마트·편의점" },
  { id: "sample-4", date: "2026-09-29", merchant: "작은별 옷가게 환불", amount: -29000, kind: "expense", category: "쇼핑" },
  { id: "sample-5", date: "2026-09-28", merchant: "구름길 교통", amount: 68000, kind: "expense", category: "교통·차량" },
  { id: "sample-6", date: "2026-09-28", merchant: "한끼식당", amount: 10000, kind: "expense", category: "식비" },
  { id: "sample-7", date: "2026-09-27", merchant: "상상마루 극장", amount: 15000, kind: "expense", category: "문화·여가" },
  { id: "sample-8", date: "2026-09-27", merchant: "모닝커피 역삼점", amount: 5500, kind: "expense", category: "카페·간식" },
  { id: "sample-9", date: "2026-09-26", merchant: "동네바구니 마트", amount: 42700, kind: "expense", category: "마트·편의점" },
  { id: "sample-10", date: "2026-09-26", merchant: "소담한상", amount: 23000, kind: "expense", category: "식비" },
  { id: "sample-11", date: "2026-09-25", merchant: "가상 급여 입금", amount: 3200000, kind: "income", category: INCOME_CATEGORY },
  { id: "sample-12", date: "2026-09-25", merchant: "가상 저축 이체", amount: 500000, kind: "expense", category: TRANSFER_CATEGORY },
  { id: "sample-13", date: "2026-09-24", merchant: "작은별 옷가게", amount: 79000, kind: "expense", category: "쇼핑" },
  { id: "sample-14", date: "2026-09-24", merchant: "한끼식당", amount: 12000, kind: "expense", category: "식비" },
  { id: "sample-15", date: "2026-09-23", merchant: "배움꽃 교실", amount: 89000, kind: "expense", category: "교육" },
  { id: "sample-16", date: "2026-09-23", merchant: "모닝커피 역삼점", amount: 4500, kind: "expense", category: "카페·간식" },
  { id: "sample-17", date: "2026-09-22", merchant: "튼튼숲 운동실", amount: 65000, kind: "expense", category: "의료·건강" },
  { id: "sample-18", date: "2026-09-22", merchant: "동네바구니 마트", amount: 36200, kind: "expense", category: "마트·편의점" },
  { id: "sample-19", date: "2026-09-21", merchant: "한끼식당", amount: 11000, kind: "expense", category: "식비" },
  { id: "sample-20", date: "2026-09-20", merchant: "상상마루 전시관", amount: 18000, kind: "expense", category: "문화·여가" },
  { id: "sample-21", date: "2026-09-20", merchant: "소담한상", amount: 32000, kind: "expense", category: "식비" },
  { id: "sample-22", date: "2026-09-19", merchant: "별빛잠 숙소", amount: 120000, kind: "expense", category: "여행·숙박" },
  { id: "sample-23", date: "2026-09-19", merchant: "구름길 교통", amount: 24000, kind: "expense", category: "교통·차량" },
  { id: "sample-24", date: "2026-09-18", merchant: "모닝커피 역삼점", amount: 4500, kind: "expense", category: "카페·간식" },
  { id: "sample-25", date: "2026-09-18", merchant: "한끼식당", amount: 10000, kind: "expense", category: "식비" },
  { id: "sample-26", date: "2026-09-17", merchant: "이어봄 통신", amount: 45000, kind: "expense", category: "주거·통신" },
  { id: "sample-27", date: "2026-09-16", merchant: "동네바구니 마트", amount: 51900, kind: "expense", category: "마트·편의점" },
  { id: "sample-28", date: "2026-09-16", merchant: "한끼식당", amount: 12000, kind: "expense", category: "식비" },
  { id: "sample-29", date: "2026-09-15", merchant: "포근울타리 보험", amount: 78000, kind: "expense", category: "금융·보험" },
  { id: "sample-30", date: "2026-09-15", merchant: "모닝커피 역삼점", amount: 4500, kind: "expense", category: "카페·간식" },
  { id: "sample-31", date: "2026-09-14", merchant: "작은별 옷가게", amount: 29000, kind: "expense", category: "쇼핑" },
  { id: "sample-32", date: "2026-09-13", merchant: "소담한상", amount: 27000, kind: "expense", category: "식비" },
  { id: "sample-33", date: "2026-09-12", merchant: "상상마루 극장", amount: 15000, kind: "expense", category: "문화·여가" },
  { id: "sample-34", date: "2026-09-11", merchant: "한끼식당", amount: 11000, kind: "expense", category: "식비" },
  { id: "sample-35", date: "2026-09-10", merchant: "햇살약방", amount: 13500, kind: "expense", category: "의료·건강" },
  { id: "sample-36", date: "2026-09-09", merchant: "동네바구니 마트", amount: 48600, kind: "expense", category: "마트·편의점" },
  { id: "sample-37", date: "2026-09-08", merchant: "모닝커피 역삼점", amount: 4500, kind: "expense", category: "카페·간식" },
  { id: "sample-38", date: "2026-09-07", merchant: "한끼식당", amount: 10000, kind: "expense", category: "식비" },
  { id: "sample-39", date: "2026-09-06", merchant: "작은별 생활가게", amount: 34000, kind: "expense", category: "쇼핑" },
  { id: "sample-40", date: "2026-09-05", merchant: "소담한상", amount: 28000, kind: "expense", category: "식비" },
  { id: "sample-41", date: "2026-09-04", merchant: "동네바구니 마트", amount: 39700, kind: "expense", category: "마트·편의점" },
  { id: "sample-42", date: "2026-09-03", merchant: "모닝커피 역삼점", amount: 4500, kind: "expense", category: "카페·간식" },
  { id: "sample-43", date: "2026-09-02", merchant: "한끼식당", amount: 11000, kind: "expense", category: "식비" },
  { id: "sample-44", date: "2026-09-01", merchant: "온기집 관리비", amount: 135000, kind: "expense", category: "주거·통신" },
  { id: "sample-45", date: "2026-09-01", merchant: "가상 생활비 이체", amount: 300000, kind: "expense", category: TRANSFER_CATEGORY },
];

const latestDate = SAMPLE_TRANSACTIONS.reduce(
  (latest, { date }) => date > latest ? date : latest,
  SAMPLE_TRANSACTIONS[0].date,
);
export const SAMPLE_RANGE: DateRange = recentMonthRange(latestDate);
