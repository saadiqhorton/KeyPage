import { useCallback, useState } from "react";

import {
  DEFAULT_KEY_ENTRY_VIEW,
  KEY_ENTRY_VIEW_STORAGE_KEY,
  parseKeyEntryView,
  type KeyEntryView,
} from "@/lib/view-mode";

function readStoredView(): KeyEntryView {
  try {
    const raw = localStorage.getItem(KEY_ENTRY_VIEW_STORAGE_KEY);
    return parseKeyEntryView(raw) ?? DEFAULT_KEY_ENTRY_VIEW;
  } catch {
    return DEFAULT_KEY_ENTRY_VIEW;
  }
}

export function useKeyEntryView(): {
  view: KeyEntryView;
  setView(next: KeyEntryView): void;
} {
  const [view, setView] = useState<KeyEntryView>(readStoredView);

  const persistView = useCallback((next: KeyEntryView) => {
    setView(next);
    try {
      localStorage.setItem(KEY_ENTRY_VIEW_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  return { view, setView: persistView };
}
