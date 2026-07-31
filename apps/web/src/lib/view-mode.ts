export const KEY_ENTRY_VIEWS = ["grid", "table", "list"] as const;

export type KeyEntryView = (typeof KEY_ENTRY_VIEWS)[number];

export const DEFAULT_KEY_ENTRY_VIEW: KeyEntryView = "grid";

export const KEY_ENTRY_VIEW_STORAGE_KEY = "keypage:v1:dashboard-view";

export function parseKeyEntryView(
  raw: string | null | undefined,
): KeyEntryView | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  return (KEY_ENTRY_VIEWS as readonly string[]).includes(raw)
    ? (raw as KeyEntryView)
    : null;
}
