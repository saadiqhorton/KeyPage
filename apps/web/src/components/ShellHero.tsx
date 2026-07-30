export function ShellHero() {
  return (
    <header className="entrance-stagger flex max-w-4xl flex-col items-start gap-8">
      <p className="border border-hairline bg-surface/70 px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted">
        SELF-HOSTED VAULT · v0.1 SHELL
      </p>

      <div className="flex flex-col gap-5">
        <h1 className="font-display text-[clamp(3.5rem,12vw,9rem)] font-medium leading-[0.92] tracking-[-0.04em] text-text">
          KeyPage
        </h1>

        <div className="h-px w-20 bg-brass" aria-hidden="true" />

        <p className="max-w-lg text-lg leading-relaxed text-muted">
          The KeyPage shell — a dark, self-hosted placeholder while the vault
          interface takes shape.
        </p>
      </div>
    </header>
  );
}
