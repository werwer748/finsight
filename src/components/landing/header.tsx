"use client";

import type { JSX } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { ButtonLink } from "@/components/ui/button";

const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
    process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

// 글자와 요소 속성을 가려서 보내므로 autocapture에는 태그와 순서만 남는다.
// 마크업이 바뀌어도 어느 링크인지 알 수 있게 이름 붙인 이벤트를 따로 보낸다.
function captureCtaClick(cta: "signup" | "login"): void {
  if (isPostHogConfigured) {
    posthog.capture("landing_cta_clicked", { cta, location: "header" });
  }
}

export function LandingHeader(): JSX.Element {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          FinSight
        </Link>
        <nav className="flex items-center gap-1">
          <ButtonLink
            href="/login"
            variant="ghost"
            onClick={() => captureCtaClick("login")}
          >
            로그인
          </ButtonLink>
          <ButtonLink href="/signup" onClick={() => captureCtaClick("signup")}>
            시작하기
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
