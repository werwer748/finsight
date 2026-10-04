import { useId } from "react";
import type { InputHTMLAttributes, JSX } from "react";

export function Input({
  label,
  error,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
}): JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        className={[
          "h-12 w-full rounded-base border bg-background px-4 text-base text-foreground placeholder:text-muted",
          "focus:outline-2 focus:-outline-offset-1",
          "disabled:bg-surface disabled:text-muted",
          error
            ? "border-danger focus:outline-danger"
            : "border-border focus:outline-primary",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...(error && { "aria-invalid": true, "aria-describedby": errorId })}
      />
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
