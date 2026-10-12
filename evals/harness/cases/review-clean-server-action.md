---
track: review
expect: pass
---

파일: `src/lib/dashboard/actions.ts`

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { classifyMerchants } from "@/services/claude";

export async function totalsByCategory(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요해요.");

  const { data, error } = await supabase
    .from("transactions")
    .select("merchant, amount")
    .eq("user_id", user.id)
    .eq("kind", "expense");
  if (error) throw new Error("거래 내역을 불러오지 못했어요. 다시 시도해 주세요.");

  const categories = await classifyMerchants(data.map((row) => row.merchant));
  const totals: Record<string, number> = {};
  for (const row of data) {
    const category = categories.get(row.merchant) ?? "기타";
    totals[category] = (totals[category] ?? 0) + row.amount;
  }
  return totals;
}
```
