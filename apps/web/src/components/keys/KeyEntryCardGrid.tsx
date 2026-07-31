import type { KeyEntry } from "@keypage/shared";

import { KeyEntryCard } from "@/components/keys/KeyEntryCard";

type KeyEntryCardGridProps = {
  entries: KeyEntry[];
};

export function KeyEntryCardGrid({ entries }: KeyEntryCardGridProps) {
  return (
    <div className="card-grid-enter grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
      {entries.map((entry) => (
        <KeyEntryCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
