import type { HealthState } from "@/hooks/useHealth";
import { cn } from "@/lib/cn";
import { formatKeyCount } from "@/lib/format";

type StatusPanelProps = {
  health: HealthState;
  /** Key Entry count when the vault is unlocked and loaded; omit when unknown. */
  entryCount?: number | null;
};

function formatFirstBoot(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

export function StatusPanel({ health, entryCount = null }: StatusPanelProps) {
  const statusLabel =
    health.status === "loading"
      ? "Checking API"
      : health.status === "ok"
        ? "API online"
        : "API unreachable";

  const statusTone =
    health.status === "loading"
      ? "bg-muted"
      : health.status === "ok"
        ? "bg-brass"
        : "bg-danger";

  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline pt-4 font-mono text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            statusTone,
            health.status === "loading" && "animate-pulse",
          )}
          aria-hidden="true"
        />
        {statusLabel}
      </span>
      {entryCount != null ? <span>{formatKeyCount(entryCount)}</span> : null}
      {health.status === "ok" ? (
        <span>since {formatFirstBoot(health.data.firstBootAt)}</span>
      ) : null}
      {health.status === "ok" && health.data.version ? (
        <span>v{health.data.version}</span>
      ) : null}
    </footer>
  );
}
