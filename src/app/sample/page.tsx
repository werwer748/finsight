import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { LandingFooter } from "@/components/landing/footer";
import { LandingHeader } from "@/components/landing/header";
import { SampleBanner } from "@/components/landing/sample-banner";
import { summarize } from "@/lib/dashboard/summarize";
import { SAMPLE_RANGE, SAMPLE_TRANSACTIONS } from "@/lib/sample/transactions";

export const metadata: Metadata = {
  title: "샘플 대시보드 | FinSight",
};

export default function SamplePage() {
  return (
    <>
      <LandingHeader />
      <main className="flex-1 bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
          <h1 className="mb-6 break-keep text-2xl font-bold tracking-tight">샘플 대시보드</h1>
          <div className="flex min-w-0 flex-col gap-6">
            <SampleBanner />
            <DashboardView
              range={SAMPLE_RANGE}
              summary={summarize(SAMPLE_TRANSACTIONS)}
              transactions={SAMPLE_TRANSACTIONS}
            />
          </div>
        </div>
      </main>
      <LandingFooter />
    </>
  );
}
