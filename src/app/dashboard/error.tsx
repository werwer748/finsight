"use client";

import type { JSX } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DashboardError({ retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}): JSX.Element {
  return (
    <main className="flex-1 bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <Card>
          <div role="alert" className="mb-6">
            <h1 className="break-keep text-2xl font-bold tracking-tight">내역을 불러오지 못했어요</h1>
            <p className="mt-2 break-keep text-muted">잠시 후 다시 시도해 주세요.</p>
          </div>
          <Button type="button" onClick={() => retry()}>다시 시도</Button>
        </Card>
      </div>
    </main>
  );
}
