import type { DragEvent } from "react";

import { cn } from "@/lib/cn";

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

export const KEY_ENTRY_DRAG_TYPE = "text/keypage-entry-id";

export function setKeyEntryDragData(
  event: DragEvent<HTMLElement>,
  entryId: string,
): void {
  event.dataTransfer.setData(KEY_ENTRY_DRAG_TYPE, entryId);
  event.dataTransfer.setData("text/plain", entryId);
  event.dataTransfer.effectAllowed = "move";
}

export function readKeyEntryDragId(event: DragEvent<HTMLElement>): string {
  return (
    event.dataTransfer.getData(KEY_ENTRY_DRAG_TYPE) ||
    event.dataTransfer.getData("text/plain")
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
  return (
    <button
      type="button"
      draggable
      disabled={disabled}
      aria-label={`Drag to reorder ${entryLabel}`}
      className={cn(controlButtonClass, "cursor-grab active:cursor-grabbing")}
      onDragStart={(event) => setKeyEntryDragData(event, entryId)}
    >
      <GripIcon className="size-3.5" />
    </button>
  );
}

type KeyEntryDropTargetProps = {
  entryId: string;
  onDropEntry(draggedId: string, targetId: string): void;
};

export function keyEntryDropTargetProps({
  entryId,
  onDropEntry,
}: KeyEntryDropTargetProps) {
  return {
    onDragOver(event: DragEvent<HTMLElement>) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop(event: DragEvent<HTMLElement>) {
      event.preventDefault();
      const draggedId = readKeyEntryDragId(event);
      if (draggedId) {
        onDropEntry(draggedId, entryId);
      }
    },
  };
}
