import { Button } from "@/components/ui/Button";

function KeyGlyph() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="text-brass"
    >
      <circle cx="14" cy="20" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M22 20h10M28 16v8M32 18v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmptyVaultState() {
  return (
    <section className="entrance-stagger flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center">
      <KeyGlyph />
      <div className="flex max-w-md flex-col gap-3">
        <h2 className="font-display text-2xl font-medium tracking-[-0.02em] text-text">
          Your vault is empty
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Key Entries will live here — locked in your browser before they reach
          the server.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Button disabled aria-describedby="add-key-caption">
          Add your first API key
        </Button>
        <p id="add-key-caption" className="max-w-xs text-xs text-muted">
          Adding Key Entries arrives in the next release.
        </p>
      </div>
    </section>
  );
}
