// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { claimEvent, releaseEvent } from "./events";

type Call = { method: string; args: unknown[] };

function fake(error: unknown = null) {
  const tables: string[] = [];
  const calls: Call[] = [];
  const builder = {
    then(resolve: (response: { error: unknown }) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve({ error }).then(resolve, reject);
    },
  } as Record<string, unknown>;
  for (const method of ["insert", "delete", "eq"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  const client = {
    from(table: string) {
      tables.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, tables, calls };
}

const EVENT_ID = "created:01a13006-d265-7cf1-97c2-3b4b3cc88051:0123456789abcdef";

describe("claimEvent", () => {
  it("처음 보는 alert는 삽입하고 true를 돌려준다", async () => {
    const { client, tables, calls } = fake();

    await expect(claimEvent(client, EVENT_ID)).resolves.toBe(true);
    expect(tables).toEqual(["oncall_events"]);
    expect(calls).toEqual([{ method: "insert", args: [{ event_id: EVENT_ID }] }]);
  });

  it("이미 받은 alert는 unique 위반으로 알아보고 false를 돌려준다", async () => {
    const { client } = fake({ code: "23505", message: "duplicate key value" });

    await expect(claimEvent(client, EVENT_ID)).resolves.toBe(false);
  });

  it("다른 오류는 중복으로 보지 않고 던진다", async () => {
    // 중복으로 보면 저장소 장애 때 alert가 조용히 사라진다.
    const { client } = fake({ code: "42501", message: "permission denied for table oncall_events" });

    await expect(claimEvent(client, EVENT_ID)).rejects.toThrow("on-call alert를 기록하지 못했어요.");
  });
});

describe("releaseEvent", () => {
  it("그 alert의 행만 지운다", async () => {
    const { client, tables, calls } = fake();

    await releaseEvent(client, EVENT_ID);

    expect(tables).toEqual(["oncall_events"]);
    expect(calls).toEqual([
      { method: "delete", args: [] },
      { method: "eq", args: ["event_id", EVENT_ID] },
    ]);
  });

  it("지우지 못하면 던진다", async () => {
    const { client } = fake({ code: "08006", message: "connection failure" });

    await expect(releaseEvent(client, EVENT_ID)).rejects.toThrow("on-call alert 기록을 지우지 못했어요.");
  });
});
