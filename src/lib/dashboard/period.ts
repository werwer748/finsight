import type { DateRange } from "@/types/dashboard";

// 가장 최근 거래일을 끝으로 하는 최근 1개월. 날짜 계산은 UTC로만 한다.
export function recentMonthRange(latestDate: string): DateRange {
  const [year, month, day] = latestDate.split("-").map(Number);
  const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));
  const start = new Date(Date.UTC(
    previousMonthEnd.getUTCFullYear(),
    previousMonthEnd.getUTCMonth(),
    Math.min(day, previousMonthEnd.getUTCDate()) + 1,
  ));
  return { from: start.toISOString().slice(0, 10), to: latestDate };
}
