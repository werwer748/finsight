// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchOncallAlert, OncallDispatchError } from "./github";
import type { OncallAlert } from "@/types/oncall";

const TOKEN_NAME = "ONCALL_GITHUB_TOKEN";
const REPOSITORY_NAME = "ONCALL_GITHUB_REPOSITORY";
// 진짜 토큰이 아니다. 오류 메시지에 새지 않는지 보려고 둔 값이다.
const TOKEN = "github_pat_test_value";
const alert: OncallAlert = {
  eventId: "spiking:01a13006-d265-7cf1-97c2-3b4b3cc88051:0123456789abcdef",
  kind: "spiking",
  issueId: "01a13006-d265-7cf1-97c2-3b4b3cc88051",
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv(TOKEN_NAME, TOKEN);
  vi.stubEnv(REPOSITORY_NAME, "owner/finsight");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("dispatchOncallAlert", () => {
  it("기본 브랜치의 on-call 워크플로우를 workflow_dispatch로 깨운다", async () => {
    await dispatchOncallAlert(alert);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/owner/finsight/actions/workflows/oncall-alert.yml/dispatches");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      ref: "main",
      inputs: { event_id: alert.eventId, kind: "spiking", issue_id: alert.issueId },
    });
  });

  it("응답을 무한정 기다리지 않는다", async () => {
    await dispatchOncallAlert(alert);

    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("GitHub가 거절하면 상태 코드만 담아 던진다", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }));

    await expect(dispatchOncallAlert(alert)).rejects.toThrow("on-call 워크플로우를 깨우지 못했어요. HTTP 상태: 401");
  });

  it("거절당한 오류는 웹훅이 로그에 적을 상태 코드를 따로 갖는다", async () => {
    // 401, 403, 404는 고칠 곳이 서로 다르다(토큰 값, 권한, 저장소 접근).
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const error = await dispatchOncallAlert(alert).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(OncallDispatchError);
    expect(error).toMatchObject({ name: "OncallDispatchError", status: 404 });
  });

  it("오류 메시지에 토큰을 싣지 않는다", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    const error = await dispatchOncallAlert(alert).catch((reason: unknown) => reason);

    expect(String(error)).not.toContain(TOKEN);
  });

  it.each([
    [TOKEN_NAME, REPOSITORY_NAME],
    [REPOSITORY_NAME, TOKEN_NAME],
  ])("%s가 없으면 요청하지 않고 그 변수 이름만 들어간 오류를 던진다", async (missing, present) => {
    vi.stubEnv(missing, "");

    const error = await dispatchOncallAlert(alert).catch((reason: unknown) => reason);

    expect(String(error)).toContain(missing);
    expect(String(error)).not.toContain(present);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("저장소 이름이 owner/name 모양이 아니면 요청하지 않는다", async () => {
    // 이 값이 URL 경로에 그대로 들어간다.
    vi.stubEnv(REPOSITORY_NAME, "owner/finsight/../../user");

    await expect(dispatchOncallAlert(alert)).rejects.toThrow(REPOSITORY_NAME);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
