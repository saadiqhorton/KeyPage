/**
 * Workstream C/D integration contract (SAA-118):
 *
 * ```ts
 * export type NewKeyEntryInput = {
 *   label: string;
 *   serviceId: string;
 *   customServiceName?: string;
 *   description?: string;
 *   tags: string[];
 *   keyValue: string;
 * };
 *
 * export function useKeyEntries(enabled: boolean): {
 *   status: "loading" | "ready" | "error";
 *   entries: KeyEntry[];
 *   error: string | null;
 *   clipboardClearMs: number;
 *   reload(): Promise<void>;
 *   createKeyEntry(input: NewKeyEntryInput): Promise<KeyEntry>;
 *   markUsed(id: string, action: KeyEntryUseAction): Promise<void>;
 * };
 * ```
 */

import type { KeyEntry, KeyEntryUseAction } from "@keypage/shared";
import { useCallback, useEffect, useState } from "react";

import { encryptKeyValue, newKeyEntryId } from "@/crypto/key-entry.js";
import {
  ApiError,
  getKeyEntries,
  postKeyEntry,
  postKeyEntryUse,
} from "@/lib/api.js";
import { resolveClipboardClearMs } from "@/lib/clipboard-timeout.js";
import { onKeyCleared } from "@/vault/session-keys.js";

export type NewKeyEntryInput = {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
  keyValue: string;
};

export type UseKeyEntriesResult = {
  status: "loading" | "ready" | "error";
  entries: KeyEntry[];
  error: string | null;
  clipboardClearMs: number;
  reload(): Promise<void>;
  createKeyEntry(input: NewKeyEntryInput): Promise<KeyEntry>;
  markUsed(id: string, action: KeyEntryUseAction): Promise<void>;
};

export function useKeyEntries(enabled: boolean): UseKeyEntriesResult {
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
      const id = newKeyEntryId();
      const cipher = await encryptKeyValue(id, input.keyValue);
      try {
        const response = await postKeyEntry({
          id,
          label: input.label,
          serviceId: input.serviceId,
          customServiceName: input.customServiceName,
          description: input.description,
          tags: input.tags,
          cipher,
        });
        setEntries((previous) => [response.entry, ...previous]);
        return response.entry;
      } catch (err) {
        if (err instanceof ApiError) {
          throw err;
        }
        throw err;
      }
    },
    [],
  );

  const markUsed = useCallback(
    async (id: string, action: KeyEntryUseAction): Promise<void> => {
      const response = await postKeyEntryUse(id, action);
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === id
            ? { ...entry, lastUsedAt: response.entry.lastUsedAt }
            : entry,
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
    markUsed,
  };
}
