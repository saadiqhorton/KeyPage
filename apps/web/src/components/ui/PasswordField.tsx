import { type InputHTMLAttributes, type ReactNode, useId, useState } from "react";

import { cn } from "@/lib/cn";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> & {
  label: string;
  error?: ReactNode;
  hint?: ReactNode;
};

export function PasswordField({
  label,
  error,
  hint,
  id,
  className,
  disabled,
  ...props
}: PasswordFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm text-text">
        {label}
      </label>
      <div className="relative">
        <input
          id={fieldId}
          type={revealed ? "text" : "password"}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "w-full rounded-sm border border-hairline bg-obsidian/60 py-2.5 pr-16 pl-3 text-sm text-text",
            "placeholder:text-muted/70",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-danger/50",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setRevealed((value) => !value)}
          className={cn(
            "absolute top-1/2 right-2 -translate-y-1/2 rounded-sm px-2 py-1",
            "font-mono text-[0.65rem] uppercase tracking-wider text-muted",
            "hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          aria-label={revealed ? "Hide password" : "Show password"}
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
      {hint ? (
        <div id={hintId} className="text-xs text-muted">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
