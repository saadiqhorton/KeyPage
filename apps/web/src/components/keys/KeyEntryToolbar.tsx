import { type TagFacet } from "@/lib/key-entry-filter";
import { type KeyEntryView } from "@/lib/view-mode";
import { SearchField } from "@/components/ui/SearchField";
import { TagFilterChips } from "@/components/keys/TagFilterChips";
import { ViewToggle } from "@/components/keys/ViewToggle";

type KeyEntryToolbarProps = {
  query: string;
  onQueryChange(next: string): void;
  view: KeyEntryView;
  onViewChange(next: KeyEntryView): void;
  facets: TagFacet[];
  tagCounts: Map<string, number>;
  selectedTagKeys: readonly string[];
  onToggleTag(key: string): void;
  visibleCount: number;
  totalCount: number;
};

export function KeyEntryToolbar({
  query,
  onQueryChange,
  view,
  onViewChange,
  facets,
  tagCounts,
  selectedTagKeys,
  onToggleTag,
  visibleCount,
  totalCount,
}: KeyEntryToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          value={query}
          onChange={onQueryChange}
          aria-label="Search Key Entries"
          className="w-full max-w-sm"
        />
        <p className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
          {visibleCount} of {totalCount} Key Entries
        </p>
        <ViewToggle value={view} onChange={onViewChange} />
      </div>

      <TagFilterChips
        facets={facets}
        counts={tagCounts}
        selected={selectedTagKeys}
        onToggle={onToggleTag}
      />
    </div>
  );
}
