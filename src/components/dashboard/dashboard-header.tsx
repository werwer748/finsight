"use client";

import { useEffect, type JSX } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
    process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export function DashboardHeader({
  email,
  userId,
}: {
  email: string;
  userId: string;
}): JSX.Element {
  useEffect(() => {
    if (!isPostHogConfigured) {
      return;
    }

    // 이메일은 PostHog에 보내지 않는다.
    posthog.identify(userId);
  }, [userId]);

  const handleSignOut = () => {
    if (isPostHogConfigured) {
      posthog.capture("logout_submitted");
      posthog.reset();
    }
  };

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          FinSight
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-muted">{email}</span>
          <form action={signOut} onSubmit={handleSignOut}>
            <Button type="submit" variant="ghost" className="shrink-0">
              로그아웃
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
