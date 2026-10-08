import type { Category } from "@/types/transaction";

// 양 끝 날짜를 포함하는 기간. 둘 다 YYYY-MM-DD다.
export type DateRange = { from: string; to: string };

export type CategoryTotal = {
  category: Category;
  amount: number; // 원 단위 정수, 항상 양수
  ratio: number; // 0~1. categories에 실린 금액의 합에 대한 비율
};

export type DashboardSummary = {
  totalExpense: number; // 이체를 뺀 지출의 합
  totalIncome: number;
  totalTransfer: number; // 이체의 합. totalExpense에 들어 있지 않다.
  categories: CategoryTotal[]; // 이체를 뺀 지출만, 금액이 큰 순
};
