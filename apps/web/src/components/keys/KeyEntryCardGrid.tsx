import type { KeyEntry } from "@keypage/shared";

import { KeyEntryCard } from "@/components/keys/KeyEntryCard";

export type KeyEntryRevealProps = {
  revealedId: string | null;
  revealedValue: string | null;
  busyId: string | null;
  onToggleReveal(entry: KeyEntry): void;
  onCopy(entry: KeyEntry): void;
};

export type KeyEntryActionProps = {
  onEdit(entry: KeyEntry): void;
  onDelete(entry: KeyEntry): void;
};

type KeyEntryCardGridProps = {
  entries: KeyEntry[];
} & KeyEntryRevealProps &
  KeyEntryActionProps;

export function KeyEntryCardGrid({
  entries,
  revealedId,
  revealedValue,
  busyId,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
}: KeyEntryCardGridProps) {
  return (
    <div className="card-grid-enter grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
      {entries.map((entry) => {
        const revealed = revealedId === entry.id;

        return (
          <KeyEntryCard
            key={entry.id}
            entry={entry}
            revealed={revealed}
            revealedValue={revealed ? revealedValue : null}
            busy={busyId === entry.id}
            onToggleReveal={() => onToggleReveal(entry)}
            onCopy={() => onCopy(entry)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
      })}
    </div>
  );
}
