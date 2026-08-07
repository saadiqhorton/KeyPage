import { cn } from "@/lib/cn";

import { useExitTransition } from "@/hooks/useExitTransition";

type IdleWarningToastProps = {
  visible: boolean;
  secondsRemaining: number;
  onStayUnlocked: () => void;
};

const TOAST_OUT_MS = 140;

export function IdleWarningToast({
  visible,
  secondsRemaining,
  onStayUnlocked,
}: IdleWarningToastProps) {
  const { rendered, closing } = useExitTransition(visible ? true : null, TOAST_OUT_MS);

  if (rendered === null) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div
        className={cn(
          "toast-surface flex max-w-md flex-wrap items-center justify-between gap-4",
          closing ? "toast-out" : "toast-in",
        )}
      >
        <p className="font-mono text-sm text-text">
          Locking in {secondsRemaining}s
        </p>
        <button
          type="button"
          onClick={onStayUnlocked}
          className="pressable rounded-sm border border-brass/50 bg-brass/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-brass hover:bg-brass/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70"
        >
          Stay unlocked
        </button>
      </div>
    </div>
  );
}
