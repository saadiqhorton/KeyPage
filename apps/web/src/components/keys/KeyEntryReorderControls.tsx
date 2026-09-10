import type { DragEvent, KeyboardEvent } from "react";

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

function ChevronUpIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 10 8 6l4 4" />
    </svg>
  );
}

function ChevronDownIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 6 8 10l4-4" />
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
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled: boolean;
  onMoveUp(): void;
  onMoveDown(): void;
};

export function KeyEntryReorderControls({
  entryId,
  entryLabel,
  canMoveUp,
  canMoveDown,
  disabled,
  onMoveUp,
  onMoveDown,
}: Readonly<KeyEntryReorderControlsProps>) {
  function handleGripKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" && canMoveUp && !disabled) {
      event.preventDefault();
      onMoveUp();
    }
    if (event.key === "ArrowDown" && canMoveDown && !disabled) {
      event.preventDefault();
      onMoveDown();
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        draggable
        disabled={disabled}
        aria-label={`Drag to reorder ${entryLabel}`}
        className={cn(controlButtonClass, "cursor-grab active:cursor-grabbing")}
        onDragStart={(event) => setKeyEntryDragData(event, entryId)}
        onKeyDown={handleGripKeyDown}
      >
        <GripIcon className="size-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled || !canMoveUp}
        aria-label={`Move ${entryLabel} up`}
        className={controlButtonClass}
        onClick={onMoveUp}
      >
        <ChevronUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        disabled={disabled || !canMoveDown}
        aria-label={`Move ${entryLabel} down`}
        className={controlButtonClass}
        onClick={onMoveDown}
      >
        <ChevronDownIcon className="size-3.5" />
      </button>
    </div>
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
