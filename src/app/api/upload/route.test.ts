// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, maxDuration } from "./route";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { countUploadsSince, recordUpload, loadMerchantCache, saveMerchantCache, saveTransactions } from "@/lib/transactions/store";
import { classifyMerchants } from "@/services/claude";
import { EMPTY_FILE_MESSAGE, UNSUPPORTED_FORMAT_MESSAGE } from "@/lib/parser/file-rules";
import { normalizeRows } from "@/lib/parser/normalize";
import { ParseError, readSheet } from "@/lib/parser/read-sheet";
import { MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_DAY } from "@/lib/upload/validate";

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/transactions/store", () => ({ countUploadsSince: vi.fn(), recordUpload: vi.fn(), loadMerchantCache: vi.fn(), saveMerchantCache: vi.fn(), saveTransactions: vi.fn() }));
vi.mock("@/services/claude", () => ({ classifyMerchants: vi.fn() }));

const supabase = {} as Awaited<ReturnType<typeof createClient>>;
const user = { id: "user-1", email: "test@example.com" };
const csv = "이용일,가맹점명,이용금액\n2026-09-01,맛집,10000\n2026-09-02,카페,5000";
const LIMIT_ERROR = "하루에 올릴 수 있는 횟수를 넘었어요. 내일 다시 시도해 주세요.";
const SERVER_ERROR = "업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";

function request(content = csv, name = "test.csv", userId?: string): Request {
  const form = new FormData();
  form.set("file", new File([content], name));
  if (userId) form.set("userId", userId);
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
  vi.mocked(getCurrentUser).mockResolvedValue(user);
  vi.mocked(createClient).mockResolvedValue(supabase);
  vi.mocked(countUploadsSince).mockResolvedValue(0);
  vi.mocked(recordUpload).mockResolvedValue(undefined);
  vi.mocked(loadMerchantCache).mockResolvedValue(new Map());
  vi.mocked(saveMerchantCache).mockResolvedValue(undefined);
  vi.mocked(classifyMerchants).mockResolvedValue(new Map([["맛집", "식비"], ["카페", "카페·간식"]]));
  vi.mocked(saveTransactions).mockResolvedValue({ inserted: 2, duplicates: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks(); });

async function expectBad(req: Request, message: string) {
  const res = await POST(req);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: message });
  expect(recordUpload).toHaveBeenCalledExactlyOnceWith(supabase, user.id);
  expect(classifyMerchants).not.toHaveBeenCalled();
  expect(saveTransactions).not.toHaveBeenCalled();
}

describe("POST /api/upload", () => {
  it("비로그인 요청은 본문과 저장소를 읽기 전에 거절한다", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const req = request();
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "로그인이 필요해요." });
    expect(req.bodyUsed).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(countUploadsSince).not.toHaveBeenCalled();
    expect(recordUpload).not.toHaveBeenCalled();
    expect(saveTransactions).not.toHaveBeenCalled();
  });
  it("이미 20회이면 본문을 읽거나 기록하지 않는다", async () => {
    vi.mocked(countUploadsSince).mockResolvedValueOnce(MAX_UPLOADS_PER_DAY);
    const req = request();
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: LIMIT_ERROR });
    expect(req.bodyUsed).toBe(false);
    expect(recordUpload).not.toHaveBeenCalled();
    expect(classifyMerchants).not.toHaveBeenCalled();
    expect(saveTransactions).not.toHaveBeenCalled();
  });
  it("기록 후 다른 요청 때문에 21회이면 본문을 읽지 않는다", async () => {
    vi.mocked(countUploadsSince).mockResolvedValueOnce(MAX_UPLOADS_PER_DAY - 1).mockResolvedValueOnce(MAX_UPLOADS_PER_DAY + 1);
    const req = request();
    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: LIMIT_ERROR });
    expect(req.bodyUsed).toBe(false);
    expect(recordUpload).toHaveBeenCalledExactlyOnceWith(supabase, user.id);
    expect(classifyMerchants).not.toHaveBeenCalled();
    expect(saveTransactions).not.toHaveBeenCalled();
  });
  it("기록 후 정확히 20회이면 처리한다", async () => {
    vi.mocked(countUploadsSince).mockResolvedValueOnce(19).mockResolvedValueOnce(20);
    expect((await POST(request())).status).toBe(200);
  });
  it("로그인 사용자와 같은 24시간 범위로 기록 전후에 센다", async () => {
    await POST(request());
    expect(countUploadsSince).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(countUploadsSince).mock.calls) {
      expect(call).toEqual([supabase, user.id, "2026-10-06T03:00:00.000Z"]);
    }
    const counts = vi.mocked(countUploadsSince).mock.invocationCallOrder;
    const record = vi.mocked(recordUpload).mock.invocationCallOrder[0];
    expect(counts[0]).toBeLessThan(record);
    expect(record).toBeLessThan(counts[1]);
  });
  it.each([false, true])("file 필드가 없거나 문자열이면 거절한다 (%s)", async (stringFile) => {
    const form = new FormData();
    if (stringFile) form.set("file", "test.csv");
    await expectBad(new Request("http://localhost/api/upload", { method: "POST", body: form }), "파일을 선택해 주세요.");
  });
  it("formData로 읽을 수 없는 본문도 400이다", async () => {
    await expectBad(new Request("http://localhost/api/upload", { method: "POST", body: "broken" }), "파일을 선택해 주세요.");
  });
  it("pdf를 거절한다", async () => { await expectBad(request(csv, "test.pdf"), UNSUPPORTED_FORMAT_MESSAGE); });
  it("빈 파일을 거절한다", async () => { await expectBad(request(""), EMPTY_FILE_MESSAGE); });
  it("4MB 초과 파일을 거절한다", async () => {
    await expectBad(request("a".repeat(MAX_UPLOAD_BYTES + 1)), "파일이 너무 커요. 4MB 이하 파일을 올려 주세요.");
  });
  it("표가 없는 파일은 실제 ParseError 문구로 거절한다", async () => {
    const content = "안내문입니다";
    let message = "";
    try { normalizeRows(readSheet(new TextEncoder().encode(content), "test.csv")); }
    catch (error) { expect(error).toBeInstanceOf(ParseError); message = (error as ParseError).message; }
    expect(message).not.toBe("");
    await expectBad(request(content), message);
  });
  it("5001건은 전체를 거절한다", async () => {
    await expectBad(request("이용일,가맹점명,이용금액\n" + Array(5001).fill("2026-09-01,맛집,1").join("\n")), "한 번에 올릴 수 있는 거래는 5,000건까지예요. 기간을 나눠서 올려 주세요.");
  });
  it("정확히 5000건은 처리한다", async () => {
    expect((await POST(request("이용일,가맹점명,이용금액\n" + Array(5000).fill("2026-09-01,맛집,1").join("\n")))).status).toBe(200);
    expect(vi.mocked(saveTransactions).mock.calls[0][2]).toHaveLength(5000);
  });
  it("하루 여유보다 미래인 거래 하나가 섞이면 전체를 거절한다", async () => {
    await expectBad(request(csv + "\n2026-10-09,맛집,1"), "미래 날짜의 거래가 들어 있어요. 파일의 날짜를 확인해 주세요.");
  });
  it("UTC 내일 날짜는 허용한다", async () => { expect((await POST(request(csv + "\n2026-10-08,맛집,1"))).status).toBe(200); });
  it("실제 파싱·분류 결과와 저장 건수를 응답한다", async () => {
    const res = await POST(request());
    expect(maxDuration).toBe(60);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ total: 2, inserted: 2, duplicates: 0, unclassified: 0 });
    expect(saveTransactions).toHaveBeenCalledExactlyOnceWith(supabase, user.id, [
      { date: "2026-09-01", time: null, merchant: "맛집", amount: 10000, kind: "expense", category: "식비" },
      { date: "2026-09-02", time: null, merchant: "카페", amount: 5000, kind: "expense", category: "카페·간식" },
    ]);
    expect(recordUpload).toHaveBeenCalledExactlyOnceWith(supabase, user.id);
    expect(loadMerchantCache).toHaveBeenCalledWith(supabase, user.id);
    expect(saveMerchantCache).toHaveBeenCalledWith(supabase, user.id, new Map([["맛집", "식비"], ["카페", "카페·간식"]]));
  });
  it("중복 건수는 저장 함수 결과를 그대로 응답한다", async () => {
    vi.mocked(saveTransactions).mockResolvedValue({ inserted: 0, duplicates: 2 });
    expect(await (await POST(request())).json()).toEqual({ total: 2, inserted: 0, duplicates: 2, unclassified: 0 });
  });
  it("은행 이체와 입금의 이름은 분류하지 않는다", async () => {
    const content = "거래일시,거래구분,기재내용,출금(원),입금(원),거래후 잔액(원)\n2026-09-01,체크카드,맛집,10000,0,100000\n2026-09-02,타행이체,이체상대,20000,0,80000\n2026-09-03,전자금융,홍길동,30000,0,50000\n2026-09-04,타행이체,김영희,0,40000,90000";
    expect((await POST(request(content))).status).toBe(200);
    expect(classifyMerchants).toHaveBeenCalledExactlyOnceWith(["맛집"]);
    expect(vi.mocked(saveTransactions).mock.calls[0][2].map(({ category }) => category)).toEqual(["식비", "이체", "이체", "수입"]);
  });
  it("분류 실패는 기타와 unclassified 수로 알려 준다", async () => {
    vi.mocked(classifyMerchants).mockResolvedValue(new Map());
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 2, inserted: 2, duplicates: 0, unclassified: 2 });
    expect(vi.mocked(saveTransactions).mock.calls[0][2].every(({ category }) => category === "기타")).toBe(true);
  });
  it.each([saveTransactions, countUploadsSince, recordUpload, getCurrentUser, createClient, loadMerchantCache, saveMerchantCache])("경계의 예외는 개인정보 없는 500으로 처리한다 (%#)", async (dependency) => {
    vi.mocked(dependency).mockRejectedValueOnce(new Error("비밀 test.csv 홍길동 10000"));
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: SERVER_ERROR });
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("비밀");
    if (dependency === saveTransactions) expect(recordUpload).toHaveBeenCalledTimes(1);
  });
  it("500 로그에는 예외의 이름만 남긴다", async () => {
    vi.mocked(saveTransactions).mockRejectedValueOnce(new TypeError("비밀 test.csv 홍길동 10000"));
    expect((await POST(request())).status).toBe(500);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("업로드를 처리하지 못했어요. 오류 종류: TypeError");
  });
  it("본문과 헤더의 사용자 ID는 무시한다", async () => {
    const req = request(csv, "test.csv", "attacker");
    req.headers.set("userId", "attacker");
    expect((await POST(req)).status).toBe(200);
    expect(vi.mocked(saveTransactions).mock.calls[0][1]).toBe(user.id);
  });
});
