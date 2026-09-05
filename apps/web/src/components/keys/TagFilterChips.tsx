import { type TagFacet } from "@/lib/key-entry-filter";
import { cn } from "@/lib/cn";

type TagFilterChipsProps = {
  facets: TagFacet[];
  counts: Map<string, number>;
  selected: readonly string[];
  onToggle(key: string): void;
};

export function TagFilterChips({
  facets,
  counts,
  selected,
  onToggle,
}: TagFilterChipsProps) {
  if (facets.length === 0) {
    return null;
  }

  return (
    <fieldset className="m-0 flex min-w-0 [min-inline-size:0] flex-wrap gap-1.5 border-0 p-0">
      <legend className="sr-only float-none p-0 [display:inherit]">Filter by tag</legend>
      {facets.map((facet) => {
        const isSelected = selected.includes(facet.key);
        const count = counts.get(facet.key) ?? 0;
        const disabled = !isSelected && count === 0;

        return (
          <button
            key={facet.key}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onToggle(facet.key)}
            className={cn(
              "pressable rounded-sm border px-2.5 py-1 font-mono text-[11px]",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
              "disabled:cursor-not-allowed disabled:opacity-40",
              isSelected
                ? "border-brass/50 bg-brass/15 text-brass shadow-[inset_0_1px_0_rgba(200,162,74,0.18)]"
                : "border-hairline bg-obsidian/55 text-muted hover:border-brass/35 hover:text-text",
            )}
          >
            {facet.label}
            <span className="ml-1.5 text-muted/80" aria-hidden>
              {count}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
