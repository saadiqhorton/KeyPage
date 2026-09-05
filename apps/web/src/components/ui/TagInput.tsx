import {
  KEY_ENTRY_TAG_MAX,
  KEY_ENTRY_TAGS_MAX,
  KeyEntryFieldError,
  normalizeTagsCapped,
} from "@keypage/shared";
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
} from "react";

import { cn } from "@/lib/cn";

type TagInputProps = {
  label: string;
  value: string[];
  onChange(next: string[]): void;
  /** Uncommitted draft text — controlled so parents can block submit on invalid drafts. */
  draft: string;
  onDraftChange(next: string): void;
  max?: number;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
};

export function TagInput({
  label,
  value,
  onChange,
  draft,
  onDraftChange,
  max,
  hint,
  error,
  disabled = false,
}: Readonly<TagInputProps>) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const atMax = max !== undefined && value.length >= max;

  function commitDraft(raw: string): boolean {
    const trimmed = raw.trim();
    if (!trimmed) {
      onDraftChange("");
      return true;
    }
    if (atMax) {
      onDraftChange("");
      return true;
    }

    if (trimmed.length > KEY_ENTRY_TAG_MAX) {
      return false;
    }

    try {
      onChange(
        normalizeTagsCapped([...value, trimmed], max ?? KEY_ENTRY_TAGS_MAX),
      );
      onDraftChange("");
      return true;
    } catch (err) {
      if (err instanceof KeyEntryFieldError) {
        return false;
      }
      throw err;
    }
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
      <label
        htmlFor={fieldId}
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-sm border border-hairline bg-obsidian/60 px-2 py-1.5",
          "focus-within:ring-1 focus-within:ring-brass/70",
          disabled && "cursor-not-allowed opacity-50",
          error && "border-danger/50",
        )}
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
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            commitDraft(draft);
          }}
        />
      </label>
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

/** Pure check used by forms that own the TagInput draft. */
export function tagDraftError(draft: string): string | null {
  const trimmed = draft.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > KEY_ENTRY_TAG_MAX) {
    return `Each tag must be 1..${KEY_ENTRY_TAG_MAX} characters.`;
  }
  return null;
}
