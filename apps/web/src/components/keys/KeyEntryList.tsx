import { KEY_ENTRY_MASK, type KeyEntry } from "@keypage/shared";

import { KeyEntryTags } from "@/components/keys/KeyEntryTags";
import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { formatShortDate } from "@/lib/format";
import { serviceDisplayName } from "@/lib/key-entry-filter";

type KeyEntryListProps = {
  entries: KeyEntry[];
};

export function KeyEntryList({ entries }: KeyEntryListProps) {
  return (
    <div className="view-enter bezel-shell">
      <div className="bezel-core">
        <ul className="divide-y divide-hairline">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-4 px-4 py-3.5">
              <ServiceIcon serviceId={entry.serviceId} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                  {serviceDisplayName(entry)}
                </p>
                <p className="mt-0.5 truncate font-display text-sm font-medium text-text">
                  {entry.label}
                </p>
                {entry.description ? (
                  <p className="mt-1 line-clamp-1 text-sm text-muted">
                    {entry.description}
                  </p>
                ) : null}
              </div>
              <div className="ml-auto hidden shrink-0 flex-col items-end gap-1.5 lg:flex">
                <KeyEntryTags tags={entry.tags} max={3} />
                <p className="text-xs tabular-nums text-muted">
                  {formatShortDate(entry.createdAt)}
                </p>
                <div aria-label="API Key hidden">
                  <span
                    className="font-mono text-xs tracking-[0.28em] text-muted/80"
                    aria-hidden
                  >
                    {KEY_ENTRY_MASK}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
