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
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
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

        <div className="bezel-shell w-full">
          <div className="bezel-core p-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
