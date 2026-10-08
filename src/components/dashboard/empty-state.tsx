import type { JSX } from "react";
import { Card } from "@/components/ui/card";

export function EmptyState(): JSX.Element {
  return (
    <Card className="py-16 text-center">
      <h2 className="text-xl font-bold tracking-tight">
        아직 분석한 내역이 없어요
      </h2>
      <p className="mt-2 break-keep text-muted">
        거래 내역 파일을 올리면 여기에서 소비 분석을 볼 수 있어요.
      </p>
    </Card>
  );
}
