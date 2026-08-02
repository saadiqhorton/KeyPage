import type { KeyEntry } from "@keypage/shared";

import { KeyEntryTags } from "@/components/keys/KeyEntryTags";
import type { KeyEntryRevealProps, KeyEntryActionProps } from "@/components/keys/key-entry-view-props";
import { KeyEntryRowActions } from "@/components/keys/KeyEntryRowActions";
import { KeyValueField } from "@/components/keys/KeyValueField";
import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { formatShortDate } from "@/lib/format";
import { serviceDisplayName } from "@/lib/key-entry-filter";

type KeyEntryTableProps = {
  entries: KeyEntry[];
} & KeyEntryRevealProps &
  KeyEntryActionProps;

export function KeyEntryTable({
  entries,
  revealedId,
  revealedValue,
  busyId,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
}: KeyEntryTableProps) {
  return (
    <div className="view-enter bezel-shell">
      <div className="bezel-core overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <caption className="sr-only">Key Entries</caption>
          <thead>
            <tr className="border-b border-hairline text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              <th scope="col" className="px-4 py-3 font-medium">
                Service
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Label
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tags
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Added
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Key
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const revealed = revealedId === entry.id;

              return (
                <tr
                  key={entry.id}
                  className="border-b border-hairline last:border-b-0 hover:bg-brass/5"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <ServiceIcon serviceId={entry.serviceId} size="sm" />
                      <span className="text-text">{serviceDisplayName(entry)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-text">{entry.label}</p>
                    {entry.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                        {entry.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <KeyEntryTags tags={entry.tags} max={3} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted">
                    {formatShortDate(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <KeyValueField
                      entryLabel={entry.label}
                      value={revealed ? revealedValue : null}
                      revealed={revealed}
                      busy={busyId === entry.id}
                      density="row"
                      onToggleReveal={() => onToggleReveal(entry)}
                      onCopy={() => onCopy(entry)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <KeyEntryRowActions
                      entry={entry}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
