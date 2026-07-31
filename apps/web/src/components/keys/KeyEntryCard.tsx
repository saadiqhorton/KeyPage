import { KEY_ENTRY_MASK, type KeyEntry } from "@keypage/shared";

import { KeyEntryTags } from "@/components/keys/KeyEntryTags";
import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { formatEntryDate } from "@/lib/format";
import { serviceDisplayName } from "@/lib/key-entry-filter";
import { cn } from "@/lib/cn";

type KeyEntryCardProps = {
  entry: KeyEntry;
  className?: string;
};

export function KeyEntryCard({ entry, className }: KeyEntryCardProps) {
  const displayName = serviceDisplayName(entry);

  return (
    <article className={cn("bezel-shell h-full", className)}>
      <div className="bezel-core flex h-full flex-col gap-4 p-5">
        <header className="flex items-start gap-3">
          <ServiceIcon serviceId={entry.serviceId} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {displayName}
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

        <KeyEntryTags tags={entry.tags} />

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
