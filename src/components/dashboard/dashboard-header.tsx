import type { JSX } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

export function DashboardHeader({ email }: { email: string }): JSX.Element {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          FinSight
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-muted">{email}</span>
          <form action={signOut}>
            <Button type="submit" variant="ghost" className="shrink-0">
              로그아웃
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
