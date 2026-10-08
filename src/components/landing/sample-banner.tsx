import type { JSX } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function SampleBanner(): JSX.Element {
  return (
    <Card>
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="break-keep text-foreground">
          가상 데이터로 만든 샘플 화면이에요. 내 거래 내역으로 보려면 가입해 주세요.
        </p>
        <ButtonLink href="/signup" size="lg" className="shrink-0">
          무료로 시작하기
        </ButtonLink>
      </div>
    </Card>
  );
}
