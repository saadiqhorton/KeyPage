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

export function Toast({ message, tone = "default" }: ToastProps) {
  const value: ToastContent | null =
    message !== null ? { message, tone } : null;
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
