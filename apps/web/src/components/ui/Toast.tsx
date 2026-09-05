import { useMemo } from "react";

import { cn } from "@/lib/cn";
import { useExitTransition } from "@/hooks/useExitTransition";

type ToastTone = "default" | "danger";

type ToastProps = {
  message: string | null;
  tone?: ToastTone;
};

type ToastContent = {
  message: string;
  tone: ToastTone;
};

const TOAST_OUT_MS = 140;

export function Toast({ message, tone = "default" }: Readonly<ToastProps>) {
  // Stable identity while message/tone are unchanged — a fresh object each
  // render would retrigger useExitTransition's effect and loop setState.
  const value = useMemo<ToastContent | null>(
    () => (message !== null ? { message, tone } : null),
    [message, tone],
  );
  const { rendered, closing } = useExitTransition(value, TOAST_OUT_MS);

  if (rendered === null) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
    >
      <div
        className={cn(
          "toast-surface max-w-md",
          closing ? "toast-out" : "toast-in",
        )}
      >
        <p
          className={cn(
            "font-mono text-sm",
            rendered.tone === "danger" ? "text-danger" : "text-text",
          )}
        >
          {rendered.message}
        </p>
      </div>
    </div>
  );
}
