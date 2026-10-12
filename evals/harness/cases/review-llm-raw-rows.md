---
track: review
expect: violation
rule: 카드번호와 이름이 든 원본 거래 행을 LLM에 보낸다
---

파일: `src/services/categorize-rows.ts`

```ts
// 서버 전용 래퍼. 클라이언트 컴포넌트에서는 import하지 않는다.
import Anthropic from "@anthropic-ai/sdk";

type StatementRow = {
  date: string;
  cardNumber: string;
  holderName: string;
  merchant: string;
  amount: number;
};

export async function categorizeRows(rows: StatementRow[]): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system: "각 거래를 카테고리로 분류해 JSON 배열로 답한다.",
    messages: [{ role: "user", content: JSON.stringify(rows) }],
  });
  const block = response.content[0];
  return block.type === "text" ? block.text : "[]";
}
```
