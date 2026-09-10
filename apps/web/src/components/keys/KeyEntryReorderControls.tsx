import { cn } from "@/lib/cn";

import { useKeyEntrySortableHandle } from "@/components/keys/KeyEntrySortable";

const controlButtonClass =
  "pressable rounded-sm p-1 text-muted hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70 disabled:cursor-not-allowed disabled:opacity-50";

function GripIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <circle cx="5" cy="3.5" r="1.1" />
      <circle cx="11" cy="3.5" r="1.1" />
      <circle cx="5" cy="8" r="1.1" />
      <circle cx="11" cy="8" r="1.1" />
      <circle cx="5" cy="12.5" r="1.1" />
      <circle cx="11" cy="12.5" r="1.1" />
    </svg>
  );
}

type KeyEntryReorderControlsProps = {
  entryId: string;
  entryLabel: string;
  disabled: boolean;
};

export function KeyEntryReorderControls({
  entryId,
  entryLabel,
  disabled,
}: Readonly<KeyEntryReorderControlsProps>) {
  const { startDrag, disabled: sortableDisabled } = useKeyEntrySortableHandle();

  return (
    <button
      type="button"
      disabled={disabled || sortableDisabled}
      aria-label={`Drag to reorder ${entryLabel}`}
      className={cn(
        controlButtonClass,
        "cursor-grab touch-none active:cursor-grabbing",
      )}
      onPointerDown={(event) => {
        startDrag(entryId, event);
      }}
    >
      <GripIcon className="size-3.5" />
    </button>
  );
}
