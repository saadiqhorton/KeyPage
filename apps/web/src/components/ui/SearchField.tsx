import { type ReactNode, useId } from "react";

import { cn } from "@/lib/cn";

type SearchFieldProps = {
  value: string;
  onChange(next: string): void;
  placeholder?: string;
  "aria-label": string;
  className?: string;
};

export function SearchField({
  value,
  onChange,
  placeholder = "Search label, Service, description…",
  "aria-label": ariaLabel,
  className,
}: Readonly<SearchFieldProps>) {
  const fieldId = useId();

  return (
    <div
      className={cn(
        "relative flex items-center rounded-sm border border-hairline bg-obsidian/60",
        "focus-within:ring-1 focus-within:ring-brass/70",
        className,
      )}
    >
      <span className="pointer-events-none pl-3 text-muted" aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        id={fieldId}
        type="search"
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "w-full bg-transparent px-2 py-2 font-mono text-sm text-text outline-none",
          "placeholder:text-muted/70",
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      {value !== "" ? (
        <button
          type="button"
          aria-label="Clear search"
          className={cn(
            "pressable mr-1.5 rounded-sm px-1.5 py-0.5 text-sm text-muted",
            "hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
          )}
          onClick={() => onChange("")}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function SearchIcon(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M10.5 10.5L14 14"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}
