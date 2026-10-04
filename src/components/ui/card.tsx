import type { JSX, ReactNode } from "react";

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={["rounded-base border border-border bg-background p-6", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
