import { KEY_ENTRY_MASK, type KeyEntry } from "@keypage/shared";

import { KeyEntryTags } from "@/components/keys/KeyEntryTags";
import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { formatShortDate } from "@/lib/format";
import { serviceDisplayName } from "@/lib/key-entry-filter";

type KeyEntryTableProps = {
  entries: KeyEntry[];
};

export function KeyEntryTable({ entries }: KeyEntryTableProps) {
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
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
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
                  <div aria-label="API Key hidden">
                    <span
                      className="font-mono text-xs tracking-[0.28em] text-muted/80"
                      aria-hidden
                    >
                      {KEY_ENTRY_MASK}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
