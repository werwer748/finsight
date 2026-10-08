import { MERCHANT_CATEGORIES, TRANSFER_CATEGORY } from "@/lib/transactions/categories";
import type { DashboardSummary } from "@/types/dashboard";
import type { CategorizedTransaction, Category } from "@/types/transaction";

export function summarize(
  transactions: readonly Pick<CategorizedTransaction, "amount" | "kind" | "category">[],
): DashboardSummary {
  let totalExpense = 0;
  let totalIncome = 0;
  let totalTransfer = 0;
  const amounts = new Map<Category, number>();

  for (const { amount, kind, category } of transactions) {
    if (kind === "income") {
      totalIncome += amount;
    } else if (category === TRANSFER_CATEGORY) {
      totalTransfer += amount;
    } else {
      totalExpense += amount;
      amounts.set(category, (amounts.get(category) ?? 0) + amount);
    }
  }

  const order = new Map<Category, number>(MERCHANT_CATEGORIES.map((category, index) => [category, index]));
  const positiveAmounts = [...amounts].filter(([, amount]) => amount > 0);
  positiveAmounts.sort(([a, amountA], [b, amountB]) =>
    amountB - amountA || (order.get(a) ?? order.size) - (order.get(b) ?? order.size),
  );
  const categorySum = positiveAmounts.reduce((sum, [, amount]) => sum + amount, 0);
  const categories = positiveAmounts.map(([category, amount]) => ({
    category, amount, ratio: amount / categorySum,
  }));

  return { totalExpense, totalIncome, totalTransfer, categories };
}
