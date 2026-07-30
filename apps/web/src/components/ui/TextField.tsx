import { type InputHTMLAttributes, type ReactNode, useId } from "react";

import { cn } from "@/lib/cn";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  error?: ReactNode;
  hint?: ReactNode;
};

export function TextField({
  label,
  error,
  hint,
  id,
  className,
  disabled,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm text-text">
        {label}
      </label>
      <input
        id={fieldId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "w-full rounded-sm border border-hairline bg-obsidian/60 px-3 py-2.5 font-mono text-sm text-text",
          "placeholder:text-muted/70",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-danger/50",
          className,
        )}
        {...props}
      />
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
