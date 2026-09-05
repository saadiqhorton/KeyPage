import type { KeyEntry } from "@keypage/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { clearScheduledClipboardClear } from "@/lib/clipboard.js";
import { clipboardFailureMessage } from "@/lib/clipboard-messages.js";
import { onKeyCleared } from "@/vault/session-keys.js";
import { useKeyEntryOperations } from "@/vault/useKeyEntryOperations.js";

export type UseKeyEntrySecretOptions = {
  clipboardClearMs: number;
  onCopied(message: string): void;
  onError(message: string): void;
  /** Optional: keep entry list lastUsedAt in sync after reveal/copy. */
  onMarkedUsed?(id: string, lastUsedAt: string | null): void;
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
  const { clipboardClearMs, onCopied, onError, onMarkedUsed } = options;
  const ops = useKeyEntryOperations();

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
        const result = await ops.revealSecret(entry);
        if (!result.ok) {
          onError("Failed to reveal API key.");
          return;
        }

        setRevealedId(entry.id);
        setRevealedValue(result.value);

        autoHideTimerRef.current = window.setTimeout(() => {
          autoHideTimerRef.current = null;
          clearPlaintext();
        }, clipboardClearMs);

        if (result.activityFailed) {
          onError("Failed to record reveal activity.");
        } else if (result.lastUsedAt !== undefined) {
          onMarkedUsed?.(entry.id, result.lastUsedAt);
        }
      } finally {
        setBusyId(null);
      }
    },
    [
      revealedId,
      clipboardClearMs,
      ops,
      onError,
      onMarkedUsed,
      clearPlaintext,
    ],
  );

  const copy = useCallback(
    async (entry: KeyEntry): Promise<void> => {
      setBusyId(entry.id);
      try {
        const result = await ops.copySecret(entry, {
          revealedValue:
            revealedId === entry.id ? revealedValue : null,
          clipboardClearMs,
        });

        if (!result.ok) {
          if (result.reason === "decrypt") {
            onError("Failed to copy API key.");
          } else {
            onError(clipboardFailureMessage(result.clipboard));
          }
          return;
        }

        // Keep confirmation visible long enough to notice (default toast is 2s).
        onCopied(`API Key copied — clears in ${result.clearSeconds}s`);
        if (result.activityFailed) {
          onError("Failed to record copy activity.");
        } else if (result.lastUsedAt !== undefined) {
          onMarkedUsed?.(entry.id, result.lastUsedAt);
        }
      } finally {
        setBusyId(null);
      }
    },
    [
      revealedId,
      revealedValue,
      clipboardClearMs,
      ops,
      onCopied,
      onError,
      onMarkedUsed,
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
