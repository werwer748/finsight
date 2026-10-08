// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { CategorizedTransaction } from "@/types/transaction";
import {
  loadMerchantCache, saveMerchantCache, saveTransactions,
  getRecentTransactions, countUploadsSince, recordUpload,
} from "./store";

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };
type Response = { data?: unknown; error?: unknown; count?: unknown };
type Reply = Response | ((query: Query) => Response);
function fake(replies: Reply[] = []) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const builder = {
        then(resolve: (response: Response) => unknown, reject: (error: unknown) => unknown) {
          const reply = replies.shift() ?? { data: [], error: null };
          return Promise.resolve(typeof reply === "function" ? reply(query) : reply).then(resolve, reject);
        },
      } as Record<string, unknown>;
      for (const method of ["select", "eq", "gte", "lte", "order", "range", "limit", "upsert", "insert"]) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}
const userId = "user-1";
const transaction: CategorizedTransaction = {
  date: "2026-09-13", time: "09:05", merchant: "가게", amount: 12000,
  kind: "expense", category: "식비",
};
const transactions = (count: number) => Array.from({ length: count }, (_, i) => ({ ...transaction, merchant: `가게${i}` }));
const call = (method: string, ...args: unknown[]): Call => ({ method, args });
function inserted(query: Query, count?: number): Response {
  const rows = query.calls.find(({ method }) => method === "upsert")!.args[0] as { fingerprint: string }[];
  return { data: rows.slice(0, count).map(({ fingerprint }) => ({ fingerprint })), error: null };
}
function expectRows(query: Query, count: number, ignoreDuplicates: boolean) {
  expect(query.table).toBe("transactions");
  const rows = query.calls[0].args[0] as Record<string, unknown>[];
  expect(rows).toHaveLength(count);
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual(["user_id", "date", "merchant", "amount", "kind", "category", "fingerprint"].sort());
    expect(row.user_id).toBe(userId);
    expect(row.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  }
  expect(query.calls[0].args[1]).toEqual({ onConflict: "user_id,fingerprint", ignoreDuplicates });
}

describe("saveTransactions", () => {
  it("삽입 응답으로 중복을 판단하고 기타 외 기존 행만 보정한다", async () => {
    const { client, queries } = fake([(query) => inserted(query, 1), {}]);
    const input = transactions(3);
    input[2].category = "기타";
    await expect(saveTransactions(client, userId, input)).resolves.toEqual({ inserted: 1, duplicates: 2 });
    expectRows(queries[0], 3, true);
    expect(queries[0].calls).toContainEqual(call("select", "fingerprint"));
    expectRows(queries[1], 1, false);
    expect(queries[1].calls[0].args[0]).toEqual([expect.objectContaining({ merchant: input[1].merchant, category: "식비" })]);
    expect(queries).toHaveLength(2);
  });

  it.each([true, false])("모두 신규이거나 중복이 전부 기타면 보정하지 않는다: %s", async (allNew) => {
    const { client, queries } = fake([allNew ? inserted : { data: [] }]);
    const input = transactions(3).map((value) => ({ ...value, category: allNew ? "식비" as const : "기타" as const }));
    await expect(saveTransactions(client, userId, input)).resolves.toEqual({ inserted: allNew ? 3 : 0, duplicates: allNew ? 0 : 3 });
    expect(queries).toHaveLength(1);
  });

  it("1200건을 500·500·200건 순서로 쓰고 모든 청크의 건수를 더한다", async () => {
    const { client, queries } = fake([inserted, inserted, inserted]);
    await expect(saveTransactions(client, userId, transactions(1200))).resolves.toEqual({ inserted: 1200, duplicates: 0 });
    [500, 500, 200].forEach((count, i) => expectRows(queries[i], count, true));
    expect(queries).toHaveLength(3);
  });

  it("두 번째 청크의 중복만 보정하고 보정 건수는 삽입 수에서 제외한다", async () => {
    const input = transactions(600);
    input[599].category = "기타";
    const { client, queries } = fake([inserted, (query) => inserted(query, 98), {}]);
    await expect(saveTransactions(client, userId, input)).resolves.toEqual({ inserted: 598, duplicates: 2 });
    expect(queries).toHaveLength(3);
    expectRows(queries[0], 500, true);
    expectRows(queries[1], 100, true);
    expectRows(queries[2], 1, false);
    expect(queries[2].calls[0].args[0]).toEqual([expect.objectContaining({ merchant: input[598].merchant })]);
  });

  it("청크를 넘는 동일 거래에도 서로 다른 지문을 붙인다", async () => {
    const { client, queries } = fake([inserted, inserted]);
    await saveTransactions(client, userId, Array(501).fill(transaction));
    const rows = queries.flatMap((query) => query.calls[0].args[0] as { fingerprint: string }[]);
    expect(new Set(rows.map(({ fingerprint }) => fingerprint)).size).toBe(501);
  });

  it("빈 거래 배열은 호출하지 않는다", async () => {
    const { client, queries } = fake();
    await expect(saveTransactions(client, userId, [])).resolves.toEqual({ inserted: 0, duplicates: 0 });
    expect(queries).toEqual([]);
  });
});

describe("조회와 캐시 저장", () => {
  it("거래가 없으면 null이고 두 번째 조회는 하지 않는다", async () => {
    const { client, queries } = fake([{ data: [] }]);
    await expect(getRecentTransactions(client, userId)).resolves.toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toContainEqual(call("select", "date"));
    expect(queries[0].calls).toContainEqual(call("order", "date", { ascending: false }));
    expect(queries[0].calls).toContainEqual(call("limit", 1));
    expect(queries[0].calls).toContainEqual(call("eq", "user_id", userId));
  });

  it("DB에서 기간을 제한하고 안정적인 순서로 1000건과 200건을 전부 읽는다", async () => {
    const rows = transactions(1200).map(({ date, merchant, amount, kind, category }, i) => ({ date, merchant, amount, kind, category, id: `id${i}` }));
    const { client, queries } = fake([{ data: [{ date: "2026-09-13" }] }, { data: rows.slice(0, 1000) }, { data: rows.slice(1000) }]);
    await expect(getRecentTransactions(client, userId)).resolves.toEqual({ range: { from: "2026-08-14", to: "2026-09-13" }, transactions: rows });
    for (const query of queries) expect(query.calls).toContainEqual(call("eq", "user_id", userId));
    queries.slice(1).forEach((query, i) => {
      expect(query.table).toBe("transactions");
      expect(query.calls).toEqual([
        call("select", "id, date, merchant, amount, kind, category"), call("eq", "user_id", userId),
        call("gte", "date", "2026-08-14"), call("lte", "date", "2026-09-13"),
        call("order", "date", { ascending: false }), call("order", "id", { ascending: true }),
        call("range", i * 1000, i * 1000 + 999),
      ]);
    });
  });

  it("최근 거래가 정확히 1000건이면 빈 페이지까지 읽는다", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `id${i}`, date: transaction.date, merchant: transaction.merchant,
      amount: transaction.amount, kind: transaction.kind, category: transaction.category,
    }));
    const { client, queries } = fake([
      { data: [{ date: transaction.date }] }, { data: rows }, { data: [] },
    ]);
    await expect(getRecentTransactions(client, userId)).resolves.toEqual({
      range: { from: "2026-08-14", to: "2026-09-13" }, transactions: rows,
    });
    expect(queries).toHaveLength(3);
    expect(queries[2].calls).toContainEqual(call("range", 1000, 1999));
    for (const query of queries) expect(query.calls).toContainEqual(call("eq", "user_id", userId));
  });

  it("캐시를 끝까지 읽고 유효하지 않은 카테고리를 버린다", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ merchant: `가게${i}`, category: "식비" }));
    const { client, queries } = fake([{ data: rows }, { data: [{ merchant: "추가", category: "교통·차량" }, { merchant: "잘못됨", category: "수입" }] }]);
    const result = await loadMerchantCache(client, userId);
    expect(result.size).toBe(1001);
    expect(result.get("추가")).toBe("교통·차량");
    expect(result.has("잘못됨")).toBe(false);
    queries.forEach((query, i) => {
      expect(query.table).toBe("merchant_categories");
      expect(query.calls).toEqual([call("select", "merchant, category"), call("eq", "user_id", userId), call("order", "merchant", { ascending: true }), call("range", i * 1000, i * 1000 + 999)]);
    });
  });

  it("정확히 1000건이면 빈 페이지까지 읽는다", async () => {
    const { client, queries } = fake([{ data: Array.from({ length: 1000 }, (_, i) => ({ merchant: `${i}`, category: "식비" })) }, { data: [] }]);
    expect((await loadMerchantCache(client, userId)).size).toBe(1000);
    expect(queries).toHaveLength(2);
  });

  it("캐시도 user_id를 붙여 500행씩 중복을 무시하고 저장한다", async () => {
    const entries = new Map(transactions(1200).map(({ merchant }) => [merchant, "식비" as const]));
    const { client, queries } = fake();
    await saveMerchantCache(client, userId, entries);
    expect(queries).toHaveLength(3);
    queries.forEach((query, i) => {
      expect(query.table).toBe("merchant_categories");
      expect(query.calls).toEqual([call("upsert", [...entries].slice(i * 500, i * 500 + 500).map(([merchant, category]) => ({ user_id: userId, merchant, category })), { onConflict: "user_id,merchant", ignoreDuplicates: true })]);
    });
  });

  it("빈 캐시는 호출하지 않는다", async () => {
    const { client, queries } = fake();
    await saveMerchantCache(client, userId, new Map());
    expect(queries).toEqual([]);
  });
});

describe("업로드 기록", () => {
  it("since를 그대로 사용해 head exact count를 반환한다", async () => {
    const since = "2026-09-12T15:00:00.000Z";
    const { client, queries } = fake([{ count: 37 }]);
    await expect(countUploadsSince(client, userId, since)).resolves.toBe(37);
    expect(queries).toEqual([{ table: "uploads", calls: [call("select", "id", { count: "exact", head: true }), call("eq", "user_id", userId), call("gte", "created_at", since)] }]);
  });

  it.each([null, undefined, "0", NaN, Infinity, -1, 1.5])("count가 유효한 건수가 아니면 거부한다: %s", async (count) => {
    const { client } = fake([{ count }]);
    await expect(countUploadsSince(client, userId, "since")).rejects.toThrow();
  });

  it("user_id만 한 번 insert한다", async () => {
    const { client, queries } = fake();
    await recordUpload(client, userId);
    expect(queries).toEqual([{ table: "uploads", calls: [call("insert", { user_id: userId })] }]);
  });
});

const failure = { error: { message: "비밀 가맹점 12000" } };
describe("Supabase 오류", () => {
  it.each([
    ["loadMerchantCache", [failure], (client: SupabaseClient) => loadMerchantCache(client, userId)],
    ["캐시 다음 페이지", [{ data: Array(1000).fill({ merchant: "가게", category: "식비" }) }, failure], (client: SupabaseClient) => loadMerchantCache(client, userId)],
    ["saveMerchantCache", [failure], (client: SupabaseClient) => saveMerchantCache(client, userId, new Map([["가게", "식비"]]))],
    ["saveTransactions 삽입", [failure], (client: SupabaseClient) => saveTransactions(client, userId, [transaction])],
    ["saveTransactions 보정", [{ data: [] }, failure], (client: SupabaseClient) => saveTransactions(client, userId, [transaction])],
    ["getRecentTransactions 최근 날짜", [failure], (client: SupabaseClient) => getRecentTransactions(client, userId)],
    ["getRecentTransactions 기간", [{ data: [{ date: "2026-09-13" }] }, failure], (client: SupabaseClient) => getRecentTransactions(client, userId)],
    ["countUploadsSince", [failure], (client: SupabaseClient) => countUploadsSince(client, userId, "since")],
    ["recordUpload", [failure], (client: SupabaseClient) => recordUpload(client, userId)],
  ] as [string, Reply[], (client: SupabaseClient) => Promise<unknown>][]) ("%s는 내용을 노출하지 않는 한국어 Error를 던진다", async (_, replies, run) => {
    const { client } = fake(replies);
    const result = run(client);
    await expect(result).rejects.toThrow(/[가-힣]/);
    await expect(result).rejects.not.toThrow("비밀 가맹점 12000");
  });
});
