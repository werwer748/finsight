import type { JSX } from "react";
import { Card } from "@/components/ui/card";
import { formatDate, formatWon } from "@/lib/format";
import type { Transaction } from "@/types/transaction";

export function TransactionTable({ transactions }: { transactions: Transaction[] }): JSX.Element {
  return (
    <Card className="min-w-0">
      <div className="flex items-baseline gap-3">
        <h2 id="transaction-table-title" className="break-keep text-xl font-bold tracking-tight text-foreground">거래 내역</h2>
        <span className="text-sm text-muted">{transactions.length}건</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table aria-labelledby="transaction-table-title" className="w-full text-left text-sm text-foreground">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="whitespace-nowrap px-3 py-3">날짜</th>
              <th scope="col" className="px-3 py-3">내용</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3">카테고리</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3 text-right tabular-nums">금액</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id} className="border-b border-border last:border-b-0">
                <td className="whitespace-nowrap px-3 py-3">{formatDate(transaction.date)}</td>
                <td className="min-w-32 break-all px-3 py-3">{transaction.merchant || "-"}</td>
                <td className="whitespace-nowrap px-3 py-3">{transaction.category}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{transaction.kind === "income" && transaction.amount >= 0 ? "+" : ""}{formatWon(transaction.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
