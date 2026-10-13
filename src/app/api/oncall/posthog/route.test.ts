// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { claimEvent, releaseEvent } from "@/lib/oncall/events";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchOncallAlert } from "@/services/github";

vi.mock("@/lib/oncall/events", () => ({ claimEvent: vi.fn(), releaseEvent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/services/github", () => ({ dispatchOncallAlert: vi.fn() }));

const SECRET = "s3cret-value-for-test";
const ISSUE_ID = "01a13006-d265-7cf1-97c2-3b4b3cc88051";
const EVENT_ID = expect.stringMatching(new RegExp(`^spiking:${ISSUE_ID}:[0-9a-f]{16}$`));
const supabase = {} as ReturnType<typeof createAdminClient>;
const payload = {
  event: "$error_tracking_issue_spiking",
  issue_id: ISSUE_ID,
  exception_timestamp: "2026-10-12T12:13:24.987Z",
};

function request(body: unknown = payload, authorization: string | null = `Bearer ${SECRET}`): Request {
  return new Request("http://localhost/api/oncall/posthog", {
    method: "POST",
    headers: authorization === null ? {} : { authorization },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("ONCALL_WEBHOOK_SECRET", SECRET);
  vi.mocked(createAdminClient).mockReturnValue(supabase);
  vi.mocked(claimEvent).mockResolvedValue(true);
  vi.mocked(releaseEvent).mockResolvedValue(undefined);
  vi.mocked(dispatchOncallAlert).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetAllMocks(); });

function expectUntouched() {
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(claimEvent).not.toHaveBeenCalled();
  expect(dispatchOncallAlert).not.toHaveBeenCalled();
}

describe("POST /api/oncall/posthog", () => {
  it("처음 보는 alert는 먼저 기록한 뒤 CI에 넘긴다", async () => {
    const order: string[] = [];
    vi.mocked(claimEvent).mockImplementation(async () => { order.push("claim"); return true; });
    vi.mocked(dispatchOncallAlert).mockImplementation(async () => { order.push("dispatch"); });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "dispatched" });
    expect(order).toEqual(["claim", "dispatch"]);
    expect(claimEvent).toHaveBeenCalledExactlyOnceWith(supabase, EVENT_ID);
    expect(dispatchOncallAlert).toHaveBeenCalledExactlyOnceWith({ eventId: EVENT_ID, kind: "spiking", issueId: ISSUE_ID });
    expect(releaseEvent).not.toHaveBeenCalled();
  });

  it("이미 받은 alert는 넘기지 않고 200으로 답한다", async () => {
    // 200이 아니면 PostHog가 같은 alert를 다시 보낸다.
    vi.mocked(claimEvent).mockResolvedValue(false);

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "duplicate" });
    expect(dispatchOncallAlert).not.toHaveBeenCalled();
    expect(releaseEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["헤더 없음", null],
    ["틀린 시크릿", "Bearer wrong-value-for-test!"],
  ])("시크릿이 맞지 않으면 본문과 저장소를 읽기 전에 거절한다: %s", async (_, authorization) => {
    const req = request(payload, authorization);

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "인증에 실패했어요." });
    expect(req.bodyUsed).toBe(false);
    expectUntouched();
  });

  it.each([undefined, ""])("시크릿이 설정되지 않았으면 어떤 요청도 받지 않는다: %j", async (value) => {
    // 빈 시크릿과 비교하면 "Bearer "만 보낸 요청이 통과한다.
    vi.stubEnv("ONCALL_WEBHOOK_SECRET", value);
    const req = request(payload, "Bearer ");

    const res = await POST(req);

    expect(res.status).toBe(503);
    expect(req.bodyUsed).toBe(false);
    expectUntouched();
  });

  it.each([
    ["JSON이 아님", "not json"],
    ["모르는 이벤트", { ...payload, event: "$pageview" }],
    ["이슈 id가 UUID가 아님", { ...payload, issue_id: "1; rm -rf /" }],
  ])("본문이 올바르지 않으면 기록하지 않고 400으로 답한다: %s", async (_, body) => {
    const res = await POST(request(body));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "alert 본문이 올바르지 않아요." });
    expectUntouched();
  });

  it("CI에 넘기지 못하면 기록을 지우고 500으로 답한다", async () => {
    // 기록이 남으면 PostHog의 재시도가 중복으로 버려져 alert가 사라진다.
    vi.mocked(dispatchOncallAlert).mockRejectedValue(new Error("on-call 워크플로우를 깨우지 못했어요. HTTP 상태: 502"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "alert를 처리하지 못했어요." });
    expect(releaseEvent).toHaveBeenCalledExactlyOnceWith(supabase, EVENT_ID);
  });

  it("기록하지 못하면 넘기지 않고 500으로 답한다", async () => {
    vi.mocked(claimEvent).mockRejectedValue(new Error("on-call alert를 기록하지 못했어요."));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(dispatchOncallAlert).not.toHaveBeenCalled();
    expect(releaseEvent).not.toHaveBeenCalled();
  });

  it("기록을 지우지 못해도 500으로 답한다", async () => {
    vi.mocked(dispatchOncallAlert).mockRejectedValue(new Error("dispatch"));
    vi.mocked(releaseEvent).mockRejectedValue(new Error("release"));

    const res = await POST(request());

    expect(res.status).toBe(500);
  });

  it("환경변수가 빠져 클라이언트를 만들지 못해도 500으로 답한다", async () => {
    vi.mocked(createAdminClient).mockImplementation(() => { throw new Error("Supabase 환경변수가 설정되지 않았습니다: SUPABASE_SECRET_KEY"); });

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(claimEvent).not.toHaveBeenCalled();
  });

  it("실패 로그에는 오류의 이름만 남긴다", async () => {
    class DispatchError extends Error { name = "DispatchError"; }
    vi.mocked(dispatchOncallAlert).mockRejectedValue(new DispatchError(`token ${SECRET}`));

    await POST(request());

    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("DispatchError");
    expect(logged).not.toContain(SECRET);
  });
});
