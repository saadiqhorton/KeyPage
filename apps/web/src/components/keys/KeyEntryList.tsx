import type { KeyEntry } from "@keypage/shared";

import { KeyEntryTags } from "@/components/keys/KeyEntryTags";
import type { KeyEntryRevealProps } from "@/components/keys/KeyEntryCardGrid";
import { KeyValueField } from "@/components/keys/KeyValueField";
import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { formatShortDate } from "@/lib/format";
import { serviceDisplayName } from "@/lib/key-entry-filter";

type KeyEntryListProps = {
  entries: KeyEntry[];
} & KeyEntryRevealProps;

export function KeyEntryList({
  entries,
  revealedId,
  revealedValue,
  busyId,
  onToggleReveal,
  onCopy,
}: KeyEntryListProps) {
  return (
    <div className="view-enter bezel-shell">
      <div className="bezel-core">
        <ul className="divide-y divide-hairline">
          {entries.map((entry) => {
            const revealed = revealedId === entry.id;

            return (
              <li
                key={entry.id}
                className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-start"
              >
                <div className="flex min-w-0 flex-1 items-start gap-4">
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
                </div>
                <div className="ml-auto hidden shrink-0 flex-col items-end gap-1.5 lg:flex">
                  <KeyEntryTags tags={entry.tags} max={3} />
                  <p className="text-xs tabular-nums text-muted">
                    {formatShortDate(entry.createdAt)}
                  </p>
                </div>
                <KeyValueField
                  entryLabel={entry.label}
                  value={revealed ? revealedValue : null}
                  revealed={revealed}
                  busy={busyId === entry.id}
                  density="row"
                  className="w-full lg:w-auto lg:shrink-0"
                  onToggleReveal={() => onToggleReveal(entry)}
                  onCopy={() => onCopy(entry)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
