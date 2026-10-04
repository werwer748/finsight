import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import Link from "next/link";

type ButtonStyleProps = {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  fullWidth?: boolean;
};

const variantClasses = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary:
    "border border-border bg-background text-foreground hover:bg-surface",
  ghost: "text-foreground hover:bg-surface",
};

const sizeClasses = {
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

function buttonClassName(
  { variant = "primary", size = "md", fullWidth }: ButtonStyleProps,
  className?: string,
): string {
  return [
    "inline-flex items-center justify-center rounded-base font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    "disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && "w-full",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps): JSX.Element {
  return (
    <button
      className={buttonClassName({ variant, size, fullWidth }, className)}
      {...props}
    />
  );
}

// 버튼처럼 보이는 내부 링크. next/link 를 감싼다.
export function ButtonLink({
  href,
  children,
  className,
  variant,
  size,
  fullWidth,
}: {
  href: string;
  children: ReactNode;
  className?: string;
} & ButtonStyleProps): JSX.Element {
  return (
    <Link
      href={href}
      className={buttonClassName({ variant, size, fullWidth }, className)}
    >
      {children}
    </Link>
  );
}
