import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadForm } from "./upload-form";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const fetchMock = vi.fn();
const file = new File(["date,merchant,amount"], "거래.csv", { type: "text/csv" });
async function submit(selected: File = file) {
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(screen.getByLabelText("거래 내역 파일"), selected);
  await user.click(screen.getByRole("button", { name: "올리기" }));
}
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ status: 200, json: async () => ({ total: 12, inserted: 12, duplicates: 0, unclassified: 0 }) });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("UploadForm", () => {
  it("change 이벤트 없이 복원된 파일도 제출 시 읽는다", async () => {
    render(<UploadForm />);
    Object.defineProperty(screen.getByLabelText("거래 내역 파일"), "files", { value: [file] });
    await userEvent.click(screen.getByRole("button", { name: "올리기" }));
    expect(fetchMock.mock.calls[0][1].body.get("file")).toBe(file);
    expect(await screen.findByRole("status")).toHaveTextContent("12건을 저장했어요.");
  });
  it("파일 형식과 기간 안내가 제출 전부터 보인다", () => {
    render(<UploadForm />);
    expect(screen.getByLabelText("거래 내역 파일")).toHaveAttribute("accept", ".csv,.xlsx,.xls");
    expect(screen.getByText("화면에는 가장 최근 거래일까지의 1개월만 나와요. 더 오래된 내역은 저장만 돼요.")).toBeInTheDocument();
  });
  it("파일이 없으면 요청 없이 오류를 알린다", async () => {
    render(<UploadForm />);
    await userEvent.click(screen.getByRole("button", { name: "올리기" }));
    expect(screen.getByRole("alert")).toHaveTextContent("파일을 선택해 주세요.");
    expect(screen.getByLabelText("거래 내역 파일")).toHaveAccessibleDescription(/파일을 선택해 주세요/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("pdf는 검증 문구를 보여주고 요청하지 않는다", async () => {
    render(<UploadForm />);
    await submit(new File(["pdf"], "내역.pdf"));
    expect(screen.getByRole("alert")).toHaveTextContent("지원하지 않는 파일 형식이에요. CSV 또는 Excel(.xlsx, .xls) 파일을 올려 주세요.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("선택한 파일을 POST하고 성공하면 서버 화면을 갱신한다", async () => {
    render(<UploadForm />);
    await submit();
    expect(fetchMock).toHaveBeenCalledWith("/api/upload", { method: "POST", body: expect.any(FormData) });
    expect(fetchMock.mock.calls[0][1].body.get("file")).toBe(file);
    expect(await screen.findByRole("status")).toHaveTextContent("12건을 저장했어요.");
    expect(screen.getByRole("status")).not.toHaveTextContent("분류하지 못한");
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("중복과 미분류 건수 및 재분류 방법을 함께 안내한다", async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ total: 15, inserted: 12, duplicates: 3, unclassified: 2 }) });
    render(<UploadForm />);
    await submit();
    expect(await screen.findByRole("status")).toHaveTextContent("12건을 저장했어요. 이미 있는 3건은 건너뛰었어요. 분류하지 못한 2건은 기타로 저장했어요. 같은 파일을 다시 올리면 다시 분류해요.");
  });
  it("400 응답의 오류를 알리고 화면은 갱신하지 않는다", async () => {
    fetchMock.mockResolvedValue({ status: 400, json: async () => ({ error: "파일을 읽지 못했어요. 다른 파일을 올려 주세요." }) });
    render(<UploadForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("파일을 읽지 못했어요. 다른 파일을 올려 주세요.");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "올리기" })).toBeEnabled();
  });
  it.each([() => Promise.reject(new Error("json")), async () => ({})])("응답 본문을 읽지 못하면 일반 오류를 알린다", async (json) => {
    fetchMock.mockResolvedValue({ status: 500, json });
    render(<UploadForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
    expect(refresh).not.toHaveBeenCalled();
  });
  it.each([{}, null, { total: 1, inserted: "1", duplicates: 0, unclassified: 0 }])("200이어도 저장 건수가 없는 본문이면 일반 오류를 알리고 화면은 갱신하지 않는다", async (body) => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => body });
    render(<UploadForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("업로드를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("네트워크 실패를 안내한다", async () => {
    fetchMock.mockRejectedValue(new Error("network"));
    render(<UploadForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("업로드에 실패했어요. 네트워크 연결을 확인해 주세요.");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("올리는 동안 버튼을 비활성화하고 진행형 문구를 보여준다", async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<UploadForm />);
    await submit();
    expect(screen.getByRole("button", { name: "올리는 중…" })).toBeDisabled();
    await act(async () => finish({ status: 200, json: async () => ({ total: 1, inserted: 1, duplicates: 0, unclassified: 0 }) }));
    expect(screen.getByRole("button", { name: "올리기" })).toBeEnabled();
  });
});
