import { useCallback, useEffect, useState } from "react";

import { getVaultStatus } from "@/lib/api.js";
import {
  formatPasswordError,
  regenerateRecoveryCodes,
} from "@/vault/master-password.js";
import { useRekeyBusy } from "@/vault/useRekeyBusy.js";

/**
 * Returns a freshly generated set rather than holding it: the codes belong in
 * vault wizard state, which survives this hook's component unmounting.
 */
export function useRecoveryCodes(): {
  remaining: number | null;
  loadingRemaining: boolean;
  busy: boolean;
  error: string | null;
  progress: string | null;
  refreshRemaining(): Promise<void>;
  regenerate(password: string): Promise<string[]>;
  clearError(): void;
} {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadingRemaining, setLoadingRemaining] = useState(true);
  const { busy, error, progress, clearError, run } = useRekeyBusy();

  const refreshRemaining = useCallback(async () => {
    setLoadingRemaining(true);
    try {
      const status = await getVaultStatus();
      setRemaining(status.recoveryCodesRemaining);
    } catch {
      setRemaining(null);
    } finally {
      setLoadingRemaining(false);
    }
  }, []);

  useEffect(() => {
    void refreshRemaining();
  }, [refreshRemaining]);

  const regenerate = useCallback(
    async (password: string): Promise<string[]> => {
      const result = await run({
        fallback: "Recovery code regeneration failed.",
        formatError: formatPasswordError,
        run: (onProgress) => regenerateRecoveryCodes(password, onProgress),
      });
      setRemaining(result.length);
      return result;
    },
    [run],
  );

  return {
    remaining,
    loadingRemaining,
    busy,
    error,
    progress,
    refreshRemaining,
    regenerate,
    clearError,
  };
}
