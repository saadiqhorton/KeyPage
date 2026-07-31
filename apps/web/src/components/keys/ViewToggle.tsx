import { KEY_ENTRY_VIEWS, type KeyEntryView } from "@/lib/view-mode";
import { cn } from "@/lib/cn";

const VIEW_LABELS: Record<KeyEntryView, string> = {
  grid: "Cards",
  table: "Table",
  list: "List",
};

type ViewToggleProps = {
  value: KeyEntryView;
  onChange(next: KeyEntryView): void;
};

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div
      role="group"
      aria-label="Key Entry view"
      className="inline-flex rounded-sm border border-hairline bg-obsidian/55 p-0.5"
    >
      {KEY_ENTRY_VIEWS.map((view) => {
        const selected = value === view;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(view)}
            className={cn(
              "pressable rounded-sm px-3 py-1.5 text-xs font-medium tracking-wide",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
              selected
                ? "border border-brass/50 bg-brass/15 text-text shadow-[inset_0_1px_0_rgba(200,162,74,0.18)]"
                : "border border-transparent text-muted hover:text-text",
            )}
          >
            {VIEW_LABELS[view]}
          </button>
        );
      })}
    </div>
  );
}
