import { type ReactNode, type SelectHTMLAttributes, useId } from "react";

import { cn } from "@/lib/cn";

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  label: string;
  error?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
};

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SelectField({
  label,
  error,
  hint,
  id,
  className,
  disabled,
  children,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm text-text">
        {label}
      </label>
      <div className="relative">
        <select
          id={fieldId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "w-full appearance-none rounded-sm border border-hairline bg-obsidian/60 py-2.5 pr-9 pl-3 text-sm text-text",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-danger/50",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
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
