import type { SupabaseClient } from "@supabase/supabase-js";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRecentTransactions } from "@/lib/transactions/store";
import type { Transaction } from "@/types/transaction";
import DashboardPage from "./page";

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/transactions/store", () => ({ getRecentTransactions: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => { throw new Error(`리다이렉트: ${path}`); }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const supabase = {} as SupabaseClient;
const transactions: Transaction[] = [
  { id: "meal", date: "2026-09-13", merchant: "동네식당", amount: 18000, kind: "expense", category: "식비" },
  { id: "coffee", date: "2026-09-12", merchant: "동네카페", amount: 7000, kind: "expense", category: "카페·간식" },
  { id: "transfer", date: "2026-09-11", merchant: "카드대금", amount: 90000, kind: "expense", category: "이체" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-10", email: "user@example.com" });
  vi.mocked(createClient).mockResolvedValue(supabase);
  vi.mocked(getRecentTransactions).mockResolvedValue(null);
});

describe("대시보드 페이지", () => {
  it("비로그인이면 로그인으로 이동하고 거래를 조회하지 않는다", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    await expect(DashboardPage()).rejects.toThrow("리다이렉트: /login");

    expect(redirect).toHaveBeenCalledWith("/login");
    expect(createClient).not.toHaveBeenCalled();
    expect(getRecentTransactions).not.toHaveBeenCalled();
  });

  it("거래가 없으면 빈 상태와 업로드 폼을 보여준다", async () => {
    render(await DashboardPage());

    expect(screen.getByRole("heading", { level: 1, name: "대시보드" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "아직 분석한 내역이 없어요" })).toBeInTheDocument();
    expect(screen.getByLabelText("거래 내역 파일")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "올리기" })).toBeInTheDocument();
  });

  it("조회 기간과 이체를 뺀 합계, 카테고리, 거래 및 업로드 폼을 보여준다", async () => {
    vi.mocked(getRecentTransactions).mockResolvedValue({
      range: { from: "2026-08-14", to: "2026-09-13" }, transactions,
    });

    render(await DashboardPage());

    expect(screen.getByText("2026.08.14 ~ 2026.09.13")).toBeInTheDocument();
    const expenseCard = screen.getByRole("heading", { name: "총 지출" }).parentElement!;
    expect(within(expenseCard).getByText("25,000원")).toBeInTheDocument();
    expect(screen.queryByText("115,000원")).not.toBeInTheDocument();
    expect(screen.getAllByText("식비").length).toBeGreaterThan(0);
    expect(screen.getAllByText("카페·간식").length).toBeGreaterThan(0);
    expect(screen.getByRole("cell", { name: "동네식당" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "카드대금" })).toBeInTheDocument();
    expect(screen.getByLabelText("거래 내역 파일")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "올리기" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "아직 분석한 내역이 없어요" })).not.toBeInTheDocument();
  });

  it("세션 클라이언트와 로그인한 사용자 ID로 거래를 조회한다", async () => {
    await DashboardPage();

    expect(getRecentTransactions).toHaveBeenCalledExactlyOnceWith(supabase, "user-10");
  });

  it("조회 실패를 오류 경계로 전달한다", async () => {
    const error = new Error("조회 실패");
    vi.mocked(getRecentTransactions).mockRejectedValue(error);

    await expect(DashboardPage()).rejects.toBe(error);
  });
});
