import type { KeyEntry } from "@keypage/shared";

import { KeyEntryTags } from "@/components/keys/KeyEntryTags";
import type {
  KeyEntryRevealProps,
  KeyEntryActionProps,
  KeyEntryReorderProps,
} from "@/components/keys/key-entry-view-props";
import { KeyEntryRowActions } from "@/components/keys/KeyEntryRowActions";
import { KeyEntryReorderControls } from "@/components/keys/KeyEntryReorderControls";
import {
  KeyEntrySortable,
  sortableLabels,
  useKeyEntrySortableItem,
} from "@/components/keys/KeyEntrySortable";
import { KeyValueField } from "@/components/keys/KeyValueField";
import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { cn } from "@/lib/cn";
import { formatShortDate } from "@/lib/format";
import { serviceDisplayName } from "@/lib/key-entry-filter";

type KeyEntryListProps = {
  entries: KeyEntry[];
} & KeyEntryRevealProps &
  KeyEntryActionProps &
  KeyEntryReorderProps;

type KeyEntryListItemProps = {
  entry: KeyEntry;
  revealed: boolean;
  revealedValue: string | null;
  busy: boolean;
  reorderBusy: boolean;
  onToggleReveal(): void;
  onCopy(): void;
  onEdit(entry: KeyEntry): void;
  onDelete(entry: KeyEntry): void;
};

function KeyEntryListItem({
  entry,
  revealed,
  revealedValue,
  busy,
  reorderBusy,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
}: Readonly<KeyEntryListItemProps>) {
  const { setRef, style, className: sortableClassName } =
    useKeyEntrySortableItem(entry.id);

  return (
    <li
      ref={setRef}
      style={style}
      className={cn(
        "key-entry-sortable-item flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-start",
        sortableClassName,
      )}
    >
      <KeyEntryReorderControls
        entryId={entry.id}
        entryLabel={entry.label}
        disabled={reorderBusy}
      />
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
        busy={busy}
        density="row"
        className="w-full lg:w-auto lg:shrink-0"
        onToggleReveal={onToggleReveal}
        onCopy={onCopy}
      />
      <KeyEntryRowActions
        entry={entry}
        onEdit={onEdit}
        onDelete={onDelete}
        className="shrink-0 self-start"
      />
    </li>
  );
}

export function KeyEntryList({
  entries,
  revealedId,
  revealedValue,
  busyId,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
  onDropEntry,
  reorderBusy,
}: KeyEntryListProps) {
  return (
    <KeyEntrySortable
      ids={entries.map((entry) => entry.id)}
      labels={sortableLabels(entries)}
      layout="vertical"
      disabled={reorderBusy}
      onDropEntry={onDropEntry}
    >
      <div className="view-enter bezel-shell">
        <div className="bezel-core">
          <ul className="divide-y divide-hairline">
            {entries.map((entry) => {
              const revealed = revealedId === entry.id;

              return (
                <KeyEntryListItem
                  key={entry.id}
                  entry={entry}
                  revealed={revealed}
                  revealedValue={revealedValue}
                  busy={busyId === entry.id}
                  reorderBusy={reorderBusy}
                  onToggleReveal={() => onToggleReveal(entry)}
                  onCopy={() => onCopy(entry)}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              );
            })}
          </ul>
        </div>
      </div>
    </KeyEntrySortable>
  );
}
