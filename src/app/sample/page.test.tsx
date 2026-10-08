import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SamplePage, { metadata } from "./page";
import { SAMPLE_TRANSACTIONS } from "@/lib/sample/transactions";
import { summarize } from "@/lib/dashboard/summarize";
import { formatWon } from "@/lib/format";

describe("샘플 페이지", () => {
  it("샘플 제목과 안내, 실제 대시보드 섹션을 업로드 폼 없이 보여준다", () => {
    render(<SamplePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("샘플 대시보드");
    expect(screen.getByText("가상 데이터로 만든 샘플 화면이에요. 내 거래 내역으로 보려면 가입해 주세요.")).toBeInTheDocument();
    for (const name of ["총 지출", "카테고리별 지출", "거래 내역"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByText(formatWon(summarize(SAMPLE_TRANSACTIONS).totalExpense))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "올리기" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("거래 내역 파일")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "무료로 시작하기" })).toHaveAttribute("href", "/signup");
  });

  it("페이지 metadata 제목을 제공한다", () => {
    expect(metadata.title).toBe("샘플 대시보드 | FinSight");
  });
});
