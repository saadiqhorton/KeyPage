import { type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type DashboardShellProps = {
  /** Optional slot for Phase G idle warning toast — rendered near the top bar. */
  children?: ReactNode;
  content: ReactNode;
  idleCountdown?: string | null;
  onLock: () => void;
  footer?: ReactNode;
  className?: string;
};

export function DashboardShell({
  children,
  content,
  idleCountdown,
  onLock,
  footer,
  className,
}: DashboardShellProps) {
  return (
    <div className={cn("flex min-h-dvh flex-col", className)}>
      <header className="border-b border-hairline bg-surface/40 px-6 py-4 md:px-12 lg:px-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="font-display text-2xl font-medium tracking-[-0.03em] text-text">
              KeyPage
            </span>
            <div className="h-px w-12 bg-brass" aria-hidden="true" />
          </div>

          <div className="flex items-center gap-3">
            {idleCountdown ? (
              <span
                className="rounded-sm border border-hairline bg-obsidian/60 px-2.5 py-1 font-mono text-xs tabular-nums text-muted"
                aria-live="polite"
              >
                {idleCountdown}
              </span>
            ) : null}
            <Button variant="secondary" size="sm" onClick={onLock}>
              Lock vault
            </Button>
          </div>
        </div>
      </header>

      {children ? (
        <div className="border-b border-hairline bg-surface/30 px-6 py-3 md:px-12 lg:px-20">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col px-6 py-12 md:px-12 md:py-16 lg:px-20">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16">
          {content}
          {footer ? <div className="mt-auto">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
