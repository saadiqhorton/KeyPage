import { KEY_ENTRY_MASK } from "@keypage/shared";

import { cn } from "@/lib/cn";

type KeyValueFieldProps = {
  entryLabel: string;
  value: string | null;
  revealed: boolean;
  busy: boolean;
  density: "card" | "row";
  onToggleReveal(): void;
  onCopy(): void;
  className?: string;
};

const controlButtonClass =
  "pressable rounded-sm p-1.5 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70 disabled:cursor-not-allowed disabled:opacity-50";

function EyeIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function KeyValueControls({
  entryLabel,
  revealed,
  busy,
  onToggleReveal,
  onCopy,
}: Readonly<
  Pick<
    KeyValueFieldProps,
    "entryLabel" | "revealed" | "busy" | "onToggleReveal" | "onCopy"
  >
>) {
  const revealLabel = revealed
    ? `Hide API Key (${entryLabel})`
    : `Reveal API Key (${entryLabel})`;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        disabled={busy}
        aria-pressed={revealed}
        aria-label={revealLabel}
        onClick={onToggleReveal}
        className={controlButtonClass}
      >
        {revealed ? (
          <EyeOffIcon className="size-4" />
        ) : (
          <EyeIcon className="size-4" />
        )}
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label="Copy API Key"
        onClick={onCopy}
        className={cn(controlButtonClass, "px-2 font-mono text-[0.65rem] uppercase tracking-wider")}
      >
        Copy
      </button>
    </div>
  );
}

function KeyValueDisplay({
  revealed,
  value,
  density,
}: Readonly<Pick<KeyValueFieldProps, "revealed" | "value" | "density">>) {
  const textSize = density === "card" ? "text-sm" : "text-xs";

  if (revealed) {
    return (
      <div aria-label="API Key revealed" className="min-w-0 flex-1">
        <span className={cn("font-mono break-all select-all text-text", textSize)}>
          {value}
        </span>
      </div>
    );
  }

  return (
    <div aria-label="API Key hidden" className="min-w-0 flex-1">
      <span
        className={cn("font-mono tracking-[0.28em] text-muted/80", textSize)}
        aria-hidden
      >
        {KEY_ENTRY_MASK}
      </span>
    </div>
  );
}

export function KeyValueField({
  entryLabel,
  value,
  revealed,
  busy,
  density,
  onToggleReveal,
  onCopy,
  className,
}: Readonly<KeyValueFieldProps>) {
  const content = (
    <>
      <KeyValueDisplay revealed={revealed} value={value} density={density} />
      <KeyValueControls
        entryLabel={entryLabel}
        revealed={revealed}
        busy={busy}
        onToggleReveal={onToggleReveal}
        onCopy={onCopy}
      />
    </>
  );

  if (density === "card") {
    return (
      <div
        className={cn(
          "rounded-sm border border-hairline bg-obsidian/50 px-3 py-2",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2">{content}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>{content}</div>
  );
}
