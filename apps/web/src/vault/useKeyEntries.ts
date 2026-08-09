import type { KeyEntry } from "@keypage/shared";
import { useCallback, useEffect, useState } from "react";

import { ApiError, getKeyEntries } from "@/lib/api.js";
import { resolveClipboardClearMs } from "@/lib/clipboard-timeout.js";
import { onKeyCleared } from "@/vault/session-keys.js";
import type {
  EditKeyEntryInput,
  NewKeyEntryInput,
} from "@/vault/keyEntryOperations.js";
import { useKeyEntryOperations } from "@/vault/useKeyEntryOperations.js";

export type { EditKeyEntryInput, NewKeyEntryInput };

export type UseKeyEntriesResult = {
  status: "loading" | "ready" | "error";
  entries: KeyEntry[];
  error: string | null;
  clipboardClearMs: number;
  reload(): Promise<void>;
  createKeyEntry(input: NewKeyEntryInput): Promise<KeyEntry>;
  updateKeyEntry(id: string, input: EditKeyEntryInput): Promise<KeyEntry>;
  deleteKeyEntry(id: string): Promise<void>;
  noteLastUsed(id: string, lastUsedAt: string | null): void;
};

export function useKeyEntries(enabled: boolean): UseKeyEntriesResult {
  const ops = useKeyEntryOperations();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [entries, setEntries] = useState<KeyEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clipboardClearMs, setClipboardClearMs] = useState(() =>
    resolveClipboardClearMs(undefined),
  );

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const response = await getKeyEntries();
      setEntries(response.entries);
      setClipboardClearMs(
        resolveClipboardClearMs(response.clipboardClearSeconds),
      );
      setStatus("ready");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to load key entries.";
      setError(message);
      setStatus("error");
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setStatus("loading");
      setEntries([]);
      setError(null);
      setClipboardClearMs(resolveClipboardClearMs(undefined));
      return;
    }
    void reload();
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return onKeyCleared(() => {
      setEntries([]);
      setStatus("loading");
      setError(null);
      setClipboardClearMs(resolveClipboardClearMs(undefined));
    });
  }, [enabled]);

  const createKeyEntry = useCallback(
    async (input: NewKeyEntryInput): Promise<KeyEntry> => {
      const entry = await ops.create(input);
      setEntries((previous) => [entry, ...previous]);
      return entry;
    },
    [ops],
  );

  const updateKeyEntry = useCallback(
    async (id: string, input: EditKeyEntryInput): Promise<KeyEntry> => {
      const entry = await ops.update(id, input);
      setEntries((previous) =>
        previous.map((item) => (item.id === id ? entry : item)),
      );
      return entry;
    },
    [ops],
  );

  const deleteKeyEntry = useCallback(
    async (id: string): Promise<void> => {
      await ops.remove(id);
      setEntries((previous) => previous.filter((entry) => entry.id !== id));
    },
    [ops],
  );

  const noteLastUsed = useCallback(
    (id: string, lastUsedAt: string | null): void => {
      setEntries((previous) =>
        previous.map((item) =>
          item.id === id ? { ...item, lastUsedAt } : item,
        ),
      );
    },
    [],
  );

  return {
    status,
    entries,
    error,
    clipboardClearMs,
    reload,
    createKeyEntry,
    updateKeyEntry,
    deleteKeyEntry,
    noteLastUsed,
  };
}
