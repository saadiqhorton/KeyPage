import { type ReactNode } from "react";

import { cn } from "@/lib/cn";

type AuthShellProps = {
  chip: string;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function AuthShell({ chip, title, children, className }: AuthShellProps) {
  return (
    <main
      className={cn(
        "flex min-h-dvh flex-col items-center justify-center px-6 py-12",
        className,
      )}
    >
      <div className="entrance-stagger flex w-full max-w-md flex-col items-center gap-8">
        <p className="border border-hairline bg-surface/70 px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted">
          {chip}
        </p>

        <div className="flex flex-col items-center gap-5 text-center">
          <h1 className="font-display text-6xl font-medium tracking-[-0.04em] text-text">
            KeyPage
          </h1>
          <div className="h-px w-20 bg-brass" aria-hidden="true" />
          {title ? (
            <p className="max-w-sm text-sm leading-relaxed text-muted">{title}</p>
          ) : null}
        </div>

        <div className="w-full rounded-sm border border-hairline bg-surface p-px shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="rounded-[3px] border border-hairline/90 bg-obsidian/80 p-6">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
