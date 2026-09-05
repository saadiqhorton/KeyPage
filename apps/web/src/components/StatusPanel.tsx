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

function statusLabelFor(status: HealthState["status"]): string {
  if (status === "loading") {
    return "Checking API";
  }
  if (status === "ok") {
    return "API online";
  }
  return "API unreachable";
}

function statusToneFor(status: HealthState["status"]): string {
  if (status === "loading") {
    return "bg-muted";
  }
  if (status === "ok") {
    return "bg-brass";
  }
  return "bg-danger";
}

export function StatusPanel({ health, entryCount = null }: Readonly<StatusPanelProps>) {
  const statusLabel = statusLabelFor(health.status);
  const statusTone = statusToneFor(health.status);

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
