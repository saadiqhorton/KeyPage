import type { KeyEntry, KeyEntryUseAction } from "@keypage/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { decryptKeyValue } from "@/crypto/key-entry.js";
import {
  clearScheduledClipboardClear,
  copyTextWithAutoClear,
} from "@/lib/clipboard.js";
import { onKeyCleared } from "@/vault/session-keys.js";

export type UseKeyEntrySecretOptions = {
  clipboardClearMs: number;
  markUsed(id: string, action: KeyEntryUseAction): Promise<void>;
  onCopied(message: string): void;
  onError(message: string): void;
};

export type UseKeyEntrySecretResult = {
  revealedId: string | null;
  revealedValue: string | null;
  busyId: string | null;
  toggleReveal(entry: KeyEntry): Promise<void>;
  copy(entry: KeyEntry): Promise<void>;
  hideAll(): void;
};

export function useKeyEntrySecret(
  options: UseKeyEntrySecretOptions,
): UseKeyEntrySecretResult {
  const { clipboardClearMs, markUsed, onCopied, onError } = options;

  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const autoHideTimerRef = useRef<number | null>(null);

  const clearPlaintext = useCallback(() => {
    if (autoHideTimerRef.current !== null) {
      clearScheduledClipboardClear(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
    setRevealedId(null);
    setRevealedValue(null);
  }, []);

  const hideAll = useCallback(() => {
    clearPlaintext();
  }, [clearPlaintext]);

  useEffect(() => {
    return onKeyCleared(clearPlaintext);
  }, [clearPlaintext]);

  useEffect(() => {
    return () => {
      clearPlaintext();
    };
  }, [clearPlaintext]);

  const toggleReveal = useCallback(
    async (entry: KeyEntry): Promise<void> => {
      if (revealedId === entry.id) {
        clearPlaintext();
        return;
      }

      setBusyId(entry.id);
      try {
        clearPlaintext();
        let value: string;
        try {
          value = await decryptKeyValue(entry);
        } catch {
          onError("Failed to reveal API key.");
          return;
        }

        setRevealedId(entry.id);
        setRevealedValue(value);

        autoHideTimerRef.current = window.setTimeout(() => {
          autoHideTimerRef.current = null;
          clearPlaintext();
        }, clipboardClearMs);

        try {
          await markUsed(entry.id, "revealed");
        } catch {
          onError("Failed to record reveal activity.");
        }
      } finally {
        setBusyId(null);
      }
    },
    [revealedId, clipboardClearMs, markUsed, onError, clearPlaintext],
  );

  const copy = useCallback(
    async (entry: KeyEntry): Promise<void> => {
      setBusyId(entry.id);
      try {
        let value: string;
        if (revealedId === entry.id && revealedValue !== null) {
          value = revealedValue;
        } else {
          try {
            value = await decryptKeyValue(entry);
          } catch {
            onError("Failed to copy API key.");
            return;
          }
        }

        try {
          await copyTextWithAutoClear(value, clipboardClearMs);
        } catch {
          onError("Failed to copy API key to clipboard.");
          return;
        }

        const seconds = Math.round(clipboardClearMs / 1000);
        // Keep confirmation visible long enough to notice (default toast is 2s).
        onCopied(`API Key copied — clears in ${seconds}s`);

        try {
          await markUsed(entry.id, "copied");
        } catch {
          onError("Failed to record copy activity.");
        }
      } finally {
        setBusyId(null);
      }
    },
    [
      revealedId,
      revealedValue,
      clipboardClearMs,
      markUsed,
      onCopied,
      onError,
    ],
  );

  return {
    revealedId,
    revealedValue,
    busyId,
    toggleReveal,
    copy,
    hideAll,
  };
}
