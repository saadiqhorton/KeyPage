import { Button } from "@/components/ui/Button";

type NoFilterMatchesStateProps = {
  onClearFilters(): void;
};

export function NoFilterMatchesState({ onClearFilters }: NoFilterMatchesStateProps) {
  return (
    <section className="entrance-stagger flex flex-1 flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="h-px w-10 bg-brass/70" aria-hidden="true" />
        <h2 className="font-display text-2xl font-medium tracking-[-0.03em] text-text">
          No matching Key Entries
        </h2>
        <p className="max-w-sm text-sm leading-relaxed text-muted">
          Try adjusting your search or tag filters to find what you are looking for.
        </p>
      </div>

      <Button variant="secondary" onClick={onClearFilters} className="min-w-[10rem]">
        Clear filters
      </Button>
    </section>
  );
}
