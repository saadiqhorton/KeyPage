import { useCallback } from "react";

import { formatPasswordError } from "@/vault/master-password.js";
import { useRekeyBusy } from "@/vault/useRekeyBusy.js";
import { useVault } from "@/vault/useVault.js";

const ENTRY_SET_MISMATCH_MESSAGE =
  "Your key entries changed while the password was being updated. Nothing was saved — please try again.";

export function useChangeMasterPassword(): {
  busy: boolean;
  error: string | null;
  progress: string | null;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  clearError(): void;
} {
  const { actions } = useVault();
  const { busy, error, progress, clearError, run } = useRekeyBusy();

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> =>
      run({
        fallback: "Password change failed.",
        onEntryMismatch: ENTRY_SET_MISMATCH_MESSAGE,
        formatError: formatPasswordError,
        run: (onProgress) =>
          actions.changeMasterPassword(
            currentPassword,
            newPassword,
            onProgress,
          ),
      }),
    [run, actions],
  );

  return {
    busy,
    error,
    progress,
    changePassword,
    clearError,
  };
}
