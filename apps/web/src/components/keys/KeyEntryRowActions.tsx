import type { KeyEntry } from "@keypage/shared";

import { KebabMenu } from "@/components/ui/KebabMenu";

type KeyEntryRowActionsProps = {
  entry: KeyEntry;
  onEdit(entry: KeyEntry): void;
  onDelete(entry: KeyEntry): void;
  className?: string;
};

export function KeyEntryRowActions({
  entry,
  onEdit,
  onDelete,
  className,
}: KeyEntryRowActionsProps) {
  return (
    <KebabMenu
      label={`Actions for ${entry.label}`}
      className={className}
      items={[
        {
          id: "edit",
          label: "Edit",
          onSelect: () => onEdit(entry),
        },
        {
          id: "delete",
          label: "Delete",
          tone: "danger",
          onSelect: () => onDelete(entry),
        },
      ]}
    />
  );
}
