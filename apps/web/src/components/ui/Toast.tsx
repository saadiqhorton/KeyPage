import { cn } from "@/lib/cn";

type ToastProps = {
  message: string | null;
  tone?: "default" | "danger";
};

export function Toast({ message, tone = "default" }: ToastProps) {
  if (message === null) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
    >
      <div className="max-w-md rounded-sm border border-hairline bg-surface px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <p
          className={cn(
            "font-mono text-sm",
            tone === "danger" ? "text-danger" : "text-text",
          )}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
