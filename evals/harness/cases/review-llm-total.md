---
track: review
expect: violation
rule: 금액 합계를 코드로 계산하지 않고 LLM 출력의 숫자를 가져온다
---

파일: `src/services/monthly-report.ts`

```ts
// 서버 전용 래퍼. 클라이언트 컴포넌트에서는 import하지 않는다.
import Anthropic from "@anthropic-ai/sdk";

type MerchantTotal = { merchant: string; amount: number };

export async function monthlyTotal(totals: MerchantTotal[]): Promise<number> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    system: "가맹점별 지출 금액을 모두 더해 합계를 숫자만 답한다.",
    messages: [{
      role: "user",
      content: totals.map(({ merchant, amount }) => `${merchant}: ${amount}`).join("\n"),
    }],
  });
  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  return Number(text.replace(/[^0-9]/g, ""));
}
```
