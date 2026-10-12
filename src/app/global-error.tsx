"use client";

import { useEffect, type JSX } from "react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import "./globals.css";

const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
    process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): JSX.Element {
  useEffect(() => {
    if (isPostHogConfigured) {
      // 서버에서 난 오류는 메시지가 가려지고 digest만 온다. 서버 로그의 error_digest와 맞춰 본다.
      posthog.captureException(error, { error_digest: error.digest });
    }
  }, [error]);

  return (
    // 루트 레이아웃을 대신하므로 html과 body, 전역 스타일을 직접 넣는다.
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">문제가 생겼어요</h1>
          <p role="alert" className="break-keep text-muted">
            화면을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
          </p>
          <Button onClick={() => retry()}>다시 시도</Button>
        </main>
      </body>
    </html>
  );
}
