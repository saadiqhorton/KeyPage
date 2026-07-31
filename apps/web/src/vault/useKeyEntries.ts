/**
 * Workstream C integration contract (SAA-116):
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
 *   reload(): Promise<void>;
 *   createKeyEntry(input: NewKeyEntryInput): Promise<KeyEntry>;
 * };
 * ```
 */

import type { KeyEntry } from "@keypage/shared";
import { useCallback, useEffect, useState } from "react";

import { encryptKeyValue, newKeyEntryId } from "@/crypto/key-entry.js";
import { ApiError, getKeyEntries, postKeyEntry } from "@/lib/api.js";
import { onKeyCleared } from "@/vault/session-keys.js";

export type NewKeyEntryInput = {
  label: string;
  serviceId: string;
  customServiceName?: string;
  description?: string;
  tags: string[];
  keyValue: string;
};

type UseKeyEntriesResult = {
  status: "loading" | "ready" | "error";
  entries: KeyEntry[];
  error: string | null;
  reload(): Promise<void>;
  createKeyEntry(input: NewKeyEntryInput): Promise<KeyEntry>;
};

export function useKeyEntries(enabled: boolean): UseKeyEntriesResult {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [entries, setEntries] = useState<KeyEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const response = await getKeyEntries();
      setEntries(response.entries);
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

  return { status, entries, error, reload, createKeyEntry };
}
