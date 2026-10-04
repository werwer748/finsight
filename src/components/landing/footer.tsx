import type { JSX } from "react";

export function LandingFooter(): JSX.Element {
  return (
    <footer className="border-t border-border">
      <p className="mx-auto w-full max-w-5xl px-4 py-8 text-center text-sm text-muted sm:px-6">
        © {new Date().getFullYear()} FinSight
      </p>
    </footer>
  );
}
