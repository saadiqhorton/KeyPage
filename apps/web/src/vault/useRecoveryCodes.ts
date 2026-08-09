import { useCallback, useEffect, useState } from "react";

import { getVaultStatus } from "@/lib/api.js";
import { formatPasswordError } from "@/vault/master-password.js";
import { useRekeyBusy } from "@/vault/useRekeyBusy.js";
import { useVault } from "@/vault/useVault.js";

export function useRecoveryCodes(): {
  remaining: number | null;
  loadingRemaining: boolean;
  busy: boolean;
  error: string | null;
  progress: string | null;
  refreshRemaining(): Promise<void>;
  regenerate(password: string): Promise<void>;
  clearError(): void;
} {
  const { actions } = useVault();
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
    async (password: string): Promise<void> => {
      await run({
        fallback: "Recovery code regeneration failed.",
        formatError: formatPasswordError,
        run: (onProgress) =>
          actions.regenerateRecoveryCodes(password, onProgress),
      });
      try {
        await refreshRemaining();
      } catch {
        // Park redirect may unmount Settings before refresh completes.
      }
    },
    [run, actions, refreshRemaining],
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
