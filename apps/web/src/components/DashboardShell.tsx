import { type ReactNode } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type DashboardShellProps = {
  /** Optional toolbar slot below the header (search, filters, view toggle). */
  children?: ReactNode;
  /** Optional header actions rendered next to the Lock vault button. */
  actions?: ReactNode;
  content: ReactNode;
  idleCountdown?: string | null;
  onLock: () => void;
  footer?: ReactNode;
  className?: string;
};

export function DashboardShell({
  children,
  actions,
  content,
  idleCountdown,
  onLock,
  footer,
  className,
}: DashboardShellProps) {
  return (
    <div className={cn("flex min-h-dvh flex-col", className)}>
      <header className="border-b border-hairline bg-surface/40 px-4 py-4 md:px-12 lg:px-20">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-col gap-2">
            <span className="font-display text-2xl font-medium tracking-[-0.03em] text-text">
              KeyPage
            </span>
            <div className="h-px w-12 bg-brass" aria-hidden="true" />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {actions}
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
        <div className="border-b border-hairline bg-surface/30 px-4 py-3 md:px-12 lg:px-20">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      ) : null}

      <div className="flex flex-1 flex-col px-4 py-8 md:px-12 md:py-16 lg:px-20">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 md:gap-16">
          {content}
          {footer ? <div className="mt-auto">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
