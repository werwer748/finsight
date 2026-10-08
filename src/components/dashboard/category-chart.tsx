import type { JSX } from "react";
import { Card } from "@/components/ui/card";
import { formatWon } from "@/lib/format";
import type { CategoryTotal } from "@/types/dashboard";

export function CategoryChart({ categories }: { categories: CategoryTotal[] }): JSX.Element {
  const maxAmount = categories.reduce((max, { amount }) => Math.max(max, amount), 0);
  return (
    <Card>
      <h2 className="break-keep text-xl font-bold tracking-tight text-foreground">카테고리별 지출</h2>
      {categories.length === 0 ? (
        <p className="mt-4 break-keep text-muted">지출 내역이 없어요.</p>
      ) : (
        <ol className="mt-6 flex flex-col gap-6">
          {categories.map(({ category, amount, ratio }) => (
            <li key={category} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                <span className="break-keep text-foreground">{category}</span>
                <div className="flex flex-wrap gap-x-3">
                  <span className="text-foreground">{formatWon(amount)}</span>
                  <span className="text-sm text-muted">{Math.round(ratio * 100)}%</span>
                </div>
              </div>
              <div aria-hidden="true" className="h-2 rounded-r-sm bg-primary" style={{ width: `${maxAmount > 0 ? amount / maxAmount * 100 : 0}%` }} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
