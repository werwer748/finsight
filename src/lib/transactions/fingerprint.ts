import { createHash } from "node:crypto";
import type { CategorizedTransaction } from "@/types/transaction";

export function withFingerprints<
  T extends Pick<CategorizedTransaction, "date" | "time" | "merchant" | "amount" | "kind">,
>(transactions: T[]): (T & { fingerprint: string })[] {
  const occurrences = new Map<string, number>();
  return transactions.map((transaction) => {
    const { date, time, merchant, amount, kind } = transaction;
    const values = [date, time, merchant, amount, kind];
    const key = JSON.stringify(values);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([...values, occurrence]))
      .digest("hex");
    return { ...transaction, fingerprint };
  });
}
