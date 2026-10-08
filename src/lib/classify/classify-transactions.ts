import type { CategorizedTransaction, MerchantCategory, ParsedTransaction } from "@/types/transaction";
import { FALLBACK_CATEGORY, INCOME_CATEGORY, TRANSFER_CATEGORY, isMerchantCategory } from "@/lib/transactions/categories";
import { toMerchantKey } from "./merchant-key";

export type ClassifyDeps = {
  loadCache: () => Promise<Map<string, MerchantCategory>>;
  classify: (keys: string[]) => Promise<Map<string, MerchantCategory>>;
  saveCache: (entries: Map<string, MerchantCategory>) => Promise<void>;
};

export type ClassifyResult = {
  transactions: CategorizedTransaction[];
  unclassified: number;
};

export async function classifyTransactions(
  transactions: ParsedTransaction[],
  deps: ClassifyDeps,
): Promise<ClassifyResult> {
  // 입금과 이체는 키를 만들기 전 제외한다. 빈 키도 외부에 보내지 않는다.
  const keys = transactions.map((transaction) =>
    transaction.kind === "income" || transaction.isTransfer
      ? ""
      : toMerchantKey(transaction.merchant),
  );
  const targets = new Set(keys.filter((key) => key !== ""));
  const categories = targets.size > 0 ? await deps.loadCache() : new Map<string, MerchantCategory>();
  const missing = [...targets].filter((key) => !categories.has(key));

  if (missing.length > 0) {
    let response = new Map<string, MerchantCategory>();
    try {
      response = await deps.classify(missing);
    } catch {
      // 예외 자체에도 가맹점 정보가 포함될 수 있으므로 고정 문구만 기록한다.
      console.error("가맹점 분류에 실패했어요.");
    }
    const requested = new Set(missing);
    const entries = new Map<string, MerchantCategory>();
    for (const [key, category] of response) {
      if (requested.has(key) && isMerchantCategory(category)) {
        entries.set(key, category);
      }
    }
    if (entries.size > 0) {
      await deps.saveCache(entries);
      for (const [key, category] of entries) categories.set(key, category);
    }
  }

  let unclassified = 0;
  const categorized = transactions.map((transaction, index): CategorizedTransaction => {
    const { date, time, merchant, amount, kind } = transaction;
    let category: CategorizedTransaction["category"];
    if (kind === "income") category = INCOME_CATEGORY;
    else if (transaction.isTransfer) category = TRANSFER_CATEGORY;
    else {
      const key = keys[index];
      const classified = key === "" ? undefined : categories.get(key);
      category = classified ?? FALLBACK_CATEGORY;
      if (key !== "" && classified === undefined) unclassified++;
    }
    return { date, time, merchant, amount, kind, category };
  });
  return { transactions: categorized, unclassified };
}
