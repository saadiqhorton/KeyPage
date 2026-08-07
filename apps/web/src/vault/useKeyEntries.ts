/**
 * Workstream C/D integration contract (SAA-118 / SAA-120):
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
 * export type EditKeyEntryInput = {
 *   label: string;
 *   serviceId: string;
 *   customServiceName?: string;
 *   description?: string;
 *   tags: string[];
 *   keyValue?: string; // non-empty ⇒ replace
 * };
 *
 * export function useKeyEntries(enabled: boolean): {
 *   status: "loading" | "ready" | "error";
 *   entries: KeyEntry[];
 *   error: string | null;
 *   clipboardClearMs: number;
 *   reload(): Promise<void>;
 *   createKeyEntry(input: NewKeyEntryInput): Promise<KeyEntry>;
 *   updateKeyEntry(id: string, input: EditKeyEntryInput): Promise<KeyEntry>;
 *   deleteKeyEntry(id: string): Promise<void>;
 *   markUsed(id: string, action: KeyEntryUseAction): Promise<void>;
 * };
 * ```
 */

import type { KeyEntry, KeyEntryUseAction } from "@keypage/shared";
import { useCallback, useEffect, useState } from "react";

import { encryptKeyValue, newKeyEntryId } from "@/crypto/key-entry.js";
import {
  ApiError,
  deleteKeyEntry as apiDeleteKeyEntry,
  getKeyEntries,
  patchKeyEntry,
  postKeyEntry,
  postKeyEntryUse,
} from "@/lib/api.js";
import { resolveClipboardClearMs } from "@/lib/clipboard-timeout.js";
import { onKeyCleared } from "@/vault/session-keys.js";
import { useRekeyLock } from "@/vault/useRekeyLock.js";

export type NewKeyEntryInput = {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
  keyValue: string;
};

export type EditKeyEntryInput = {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
  keyValue?: string;
};

export type UseKeyEntriesResult = {
  status: "loading" | "ready" | "error";
  entries: KeyEntry[];
  error: string | null;
  clipboardClearMs: number;
  reload(): Promise<void>;
  createKeyEntry(input: NewKeyEntryInput): Promise<KeyEntry>;
  updateKeyEntry(id: string, input: EditKeyEntryInput): Promise<KeyEntry>;
  deleteKeyEntry(id: string): Promise<void>;
  markUsed(id: string, action: KeyEntryUseAction): Promise<void>;
};

export function useKeyEntries(enabled: boolean): UseKeyEntriesResult {
  const guardRekey = useRekeyLock();
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
      const response = await guardRekey(
        postKeyEntry({
          id,
          label: input.label,
          serviceId: input.serviceId,
          customServiceName: input.customServiceName,
          description: input.description,
          tags: input.tags,
          cipher,
        }),
      );
      setEntries((previous) => [response.entry, ...previous]);
      return response.entry;
    },
    [guardRekey],
  );

  const updateKeyEntry = useCallback(
    async (id: string, input: EditKeyEntryInput): Promise<KeyEntry> => {
      const body: Parameters<typeof patchKeyEntry>[1] = {
        label: input.label,
        serviceId: input.serviceId,
        customServiceName: input.customServiceName,
        description: input.description,
        tags: input.tags,
      };

      if (input.keyValue && input.keyValue.length > 0) {
        body.cipher = await encryptKeyValue(id, input.keyValue);
      }

      const response = await guardRekey(patchKeyEntry(id, body));
      setEntries((previous) =>
        previous.map((entry) =>
          entry.id === id ? response.entry : entry,
        ),
      );
      return response.entry;
    },
    [guardRekey],
  );

  const deleteKeyEntry = useCallback(async (id: string): Promise<void> => {
    await apiDeleteKeyEntry(id);
    setEntries((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

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
    updateKeyEntry,
    deleteKeyEntry,
    markUsed,
  };
}
