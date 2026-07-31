type IdleWarningToastProps = {
  visible: boolean;
  secondsRemaining: number;
  onStayUnlocked: () => void;
};

export function IdleWarningToast({
  visible,
  secondsRemaining,
  onStayUnlocked,
}: IdleWarningToastProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div className="flex max-w-md flex-wrap items-center justify-between gap-4 rounded-sm border border-hairline bg-surface px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <p className="font-mono text-sm text-text">
          Locking in {secondsRemaining}s
        </p>
        <button
          type="button"
          onClick={onStayUnlocked}
          className="rounded-sm border border-brass/50 bg-brass/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] text-brass transition-colors hover:bg-brass/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70"
        >
          Stay unlocked
        </button>
      </div>
    </div>
  );
}
