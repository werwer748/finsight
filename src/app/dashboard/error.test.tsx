import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DashboardError from "./error";

describe("대시보드 오류 화면", () => {
  it("제목과 재시도 안내를 보여준다", () => {
    render(<DashboardError error={new Error("내부 조회 오류")} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "내역을 불러오지 못했어요" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("잠시 후 다시 시도해 주세요.");
  });

  it("다시 시도 버튼을 누르면 retry를 호출한다", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<DashboardError error={new Error("내부 조회 오류")} retry={retry} />);

    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("예외의 메시지를 화면에 노출하지 않는다", () => {
    render(<DashboardError error={new Error("민감한 내부 조회 오류")} retry={vi.fn()} />);

    expect(screen.queryByText(/민감한 내부 조회 오류/)).not.toBeInTheDocument();
  });
});
