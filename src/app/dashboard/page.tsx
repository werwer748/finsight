import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "대시보드 | FinSight",
};

// 사용자마다 다른 페이지라 요청 시점에만 렌더링한다.
// 빌드 때 미리 렌더링하면 환경변수 없이는 Supabase 클라이언트 생성에서 예외가 난다.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // proxy가 먼저 막지만 페이지에서도 한 번 더 확인한다.
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <DashboardHeader email={user.email} />
      <main className="flex-1 bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
          <h1 className="mb-6 text-2xl font-bold tracking-tight">대시보드</h1>
          <EmptyState />
        </div>
      </main>
    </>
  );
}
