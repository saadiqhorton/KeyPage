import {
  getService,
  KEY_ENTRY_MASK,
  type KeyEntry,
} from "@keypage/shared";

import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { formatEntryDate } from "@/lib/format";
import { cn } from "@/lib/cn";

type KeyEntryCardProps = {
  entry: KeyEntry;
  className?: string;
};

export function KeyEntryCard({ entry, className }: KeyEntryCardProps) {
  const service =
    entry.serviceId === "custom" && entry.customServiceName
      ? { displayName: entry.customServiceName, accent: getService("custom").accent }
      : getService(entry.serviceId);

  return (
    <article className={cn("bezel-shell h-full", className)}>
      <div className="bezel-core flex h-full flex-col gap-4 p-5">
        <header className="flex items-start gap-3">
          <ServiceIcon serviceId={entry.serviceId} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {service.displayName}
            </p>
            <h3 className="mt-0.5 truncate font-display text-base font-medium tracking-[-0.01em] text-text">
              {entry.label}
            </h3>
          </div>
        </header>

        {entry.description ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted">
            {entry.description}
          </p>
        ) : null}

        {entry.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {entry.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-sm border border-brass/25 bg-brass/10 px-2 py-0.5 font-mono text-[11px] text-brass"
              >
                {tag}
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="mt-auto flex flex-col gap-2.5 border-t border-hairline pt-4">
          <p className="text-xs text-muted">{formatEntryDate(entry.createdAt)}</p>
          <div
            className="rounded-sm border border-hairline bg-obsidian/50 px-3 py-2"
            aria-label="API Key hidden"
          >
            <span className="font-mono text-sm tracking-[0.28em] text-muted/80" aria-hidden>
              {KEY_ENTRY_MASK}
            </span>
          </div>
        </footer>
      </div>
    </article>
  );
}
