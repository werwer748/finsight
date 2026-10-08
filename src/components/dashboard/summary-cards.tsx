import type { JSX } from "react";
import { Card } from "@/components/ui/card";
import { formatWon } from "@/lib/format";

export function SummaryCards({ totalExpense, totalIncome, totalTransfer }: {
  totalExpense: number;
  totalIncome: number;
  totalTransfer: number;
}): JSX.Element {
  return (
    <div className="grid min-w-0 gap-6 sm:grid-cols-2">
      <Card className="min-w-0 sm:col-span-2">
        <h2 className="break-keep text-xl font-bold tracking-tight text-foreground">총 지출</h2>
        <p className="mt-2 break-words text-5xl font-bold text-foreground">{formatWon(totalExpense)}</p>
      </Card>
      <Card className="min-w-0">
        <h2 className="break-keep text-xl font-bold tracking-tight text-foreground">총 수입</h2>
        <p className="mt-2 break-words text-2xl font-bold text-foreground">{formatWon(totalIncome)}</p>
      </Card>
      {totalTransfer !== 0 && (
        <Card className="min-w-0">
          <h2 className="break-keep text-xl font-bold tracking-tight text-foreground">이체</h2>
          <p className="mt-2 break-words text-2xl font-bold text-foreground">{formatWon(totalTransfer)}</p>
          <p className="mt-2 break-keep text-sm text-muted">카드 결제가 아닌 계좌 출금이에요. 총 지출에는 넣지 않았어요.</p>
        </Card>
      )}
    </div>
  );
}
