import type { JSX } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";

export function LandingHeader(): JSX.Element {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          FinSight
        </Link>
        <nav className="flex items-center gap-1">
          <ButtonLink href="/login" variant="ghost">
            로그인
          </ButtonLink>
          <ButtonLink href="/signup">시작하기</ButtonLink>
        </nav>
      </div>
    </header>
  );
}
