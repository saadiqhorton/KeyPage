import { SERVICE_CATALOG } from "@keypage/shared";
import type { HealthState } from "@/hooks/useHealth";
import { cn } from "@/lib/cn";

type StatusPanelProps = {
  health: HealthState;
};

function formatFirstBoot(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

export function StatusPanel({ health }: StatusPanelProps) {
  const catalogCount =
    health.status === "ok"
      ? health.data.serviceCatalogSize
      : SERVICE_CATALOG.length;

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
        : "bg-[#B85C5C]";

  return (
    <aside className="entrance-delayed w-full max-w-md">
      <div className="rounded-sm border border-hairline bg-surface p-px shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="rounded-[3px] border border-hairline/90 bg-obsidian/80 p-6">
          <div className="mb-6 flex items-center gap-3 border-b border-hairline pb-4">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                statusTone,
                health.status === "loading" && "animate-pulse",
              )}
              aria-hidden="true"
            />
            <p className="font-mono text-sm tracking-wide text-text">
              {statusLabel}
            </p>
          </div>

          <dl className="space-y-4 font-mono text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">Services in catalog</dt>
              <dd className="tabular-nums text-text">{catalogCount}</dd>
            </div>

            {health.status === "ok" ? (
              <div className="flex items-baseline justify-between gap-4 border-t border-hairline pt-4">
                <dt className="text-muted">First boot</dt>
                <dd className="text-right text-text">
                  {formatFirstBoot(health.data.firstBootAt)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </aside>
  );
}
