import type { KeyEntry } from "@keypage/shared";

export type KeyEntryRevealProps = {
  revealedId: string | null;
  revealedValue: string | null;
  busyId: string | null;
  onToggleReveal(entry: KeyEntry): void;
  onCopy(entry: KeyEntry): void;
};

export type KeyEntryActionProps = {
  onEdit(entry: KeyEntry): void;
  onDelete(entry: KeyEntry): void;
};

export type KeyEntryReorderProps = {
  canMoveUp(entry: KeyEntry): boolean;
  canMoveDown(entry: KeyEntry): boolean;
  onMoveUp(entry: KeyEntry): void;
  onMoveDown(entry: KeyEntry): void;
  onDropEntry(draggedId: string, targetId: string): void;
  reorderBusy: boolean;
};
