import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/cn";

type TagInputProps = {
  label: string;
  value: string[];
  onChange(next: string[]): void;
  max?: number;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
};

function normalizeTags(raw: string[], max?: number): string[] {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const tag of raw) {
    const trimmed = tag.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    next.push(trimmed);
    if (max !== undefined && next.length >= max) break;
  }

  return next;
}

export function TagInput({
  label,
  value,
  onChange,
  max,
  hint,
  error,
  disabled = false,
}: TagInputProps) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const atMax = max !== undefined && value.length >= max;

  function commitDraft(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || atMax) {
      setDraft("");
      return;
    }

    onChange(normalizeTags([...value, trimmed], max));
    setDraft("");
  }

  function removeTag(index: number) {
    onChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft(draft);
      return;
    }

    if (event.key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm text-text">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-sm border border-hairline bg-obsidian/60 px-2 py-1.5",
          "focus-within:ring-1 focus-within:ring-brass/70",
          disabled && "cursor-not-allowed opacity-50",
          error && "border-danger/50",
        )}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-sm border border-brass/30 bg-brass/15 px-2 py-0.5 text-xs text-text"
          >
            {tag}
            <button
              type="button"
              disabled={disabled}
              className="rounded-sm text-muted hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70 disabled:pointer-events-none"
              aria-label={`Remove tag ${tag}`}
              onClick={(event) => {
                event.stopPropagation();
                removeTag(index);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          value={draft}
          disabled={disabled || atMax}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
          placeholder={atMax ? undefined : "Add tag…"}
          className={cn(
            "min-w-[8ch] flex-1 bg-transparent px-1 py-1 font-mono text-sm text-text outline-none",
            "placeholder:text-muted/70",
            "disabled:cursor-not-allowed",
          )}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commitDraft(draft)}
        />
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
