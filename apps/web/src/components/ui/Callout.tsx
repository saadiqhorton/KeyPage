import { type ReactNode } from "react";

import { cn } from "@/lib/cn";

type CalloutTone = "info" | "warning" | "danger";

type CalloutProps = {
  tone?: CalloutTone;
  children: ReactNode;
  className?: string;
};

const toneClasses: Record<CalloutTone, string> = {
  info: "border-hairline bg-surface/50 text-muted",
  warning: "border-brass/30 bg-brass/8 text-text",
  danger: "border-danger/40 bg-danger/10 text-text",
};

export function Callout({ tone = "info", children, className }: CalloutProps) {
  return (
    <div
      className={cn(
        "rounded-sm border px-3.5 py-3 text-sm leading-relaxed",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
