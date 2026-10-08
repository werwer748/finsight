import type { JSX } from "react";
import { formatDate } from "@/lib/format";
import type { DashboardSummary, DateRange } from "@/types/dashboard";
import type { Transaction } from "@/types/transaction";
import { SummaryCards } from "./summary-cards";
import { CategoryChart } from "./category-chart";
import { TransactionTable } from "./transaction-table";

export function DashboardView({ range, summary, transactions }: {
  range: DateRange;
  summary: DashboardSummary;
  transactions: Transaction[];
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <p className="text-foreground">{formatDate(range.from)} ~ {formatDate(range.to)}</p>
        <p className="text-sm text-muted">최근 1개월</p>
      </div>
      <SummaryCards totalExpense={summary.totalExpense} totalIncome={summary.totalIncome} totalTransfer={summary.totalTransfer} />
      <CategoryChart categories={summary.categories} />
      <TransactionTable transactions={transactions} />
    </div>
  );
}
