import { Button } from "@/components/ui/Button";

function KeyGlyph() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="text-brass"
    >
      <circle cx="14" cy="20" r="8" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M22 20h10M28 16v8M32 18v4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

type EmptyVaultStateProps = {
  onAddKey(): void;
  busy?: boolean;
};

export function EmptyVaultState({ onAddKey, busy = false }: EmptyVaultStateProps) {
  return (
    <section className="entrance-stagger flex flex-1 flex-col items-center justify-center gap-7 py-20 text-center">
      <div className="bezel-shell">
        <div className="bezel-core flex size-16 items-center justify-center">
          <KeyGlyph />
        </div>
      </div>

      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="h-px w-10 bg-brass/70" aria-hidden="true" />
        <h2 className="font-display text-3xl font-medium tracking-[-0.03em] text-text">
          Your vault is empty
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-muted">
          Add a Key Entry to get started. API keys are encrypted in your browser
          before they reach the server.
        </p>
      </div>

      <Button onClick={onAddKey} loading={busy} className="min-w-[12rem]">
        Add your first API key
      </Button>
    </section>
  );
}
