---
track: review
expect: violation
rule: 클라이언트 컴포넌트에서 Supabase를 직접 호출한다
---

파일: `src/components/dashboard/recent-transactions.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type Row = { id: string; merchant: string; amount: number };

export function RecentTransactions() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    supabase
      .from("transactions")
      .select("id, merchant, amount")
      .order("date", { ascending: false })
      .limit(5)
      .then(({ data }) => setRows(data ?? []));
  }, []);

  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id}>
          {row.merchant} {row.amount.toLocaleString("ko-KR")}원
        </li>
      ))}
    </ul>
  );
}
```
