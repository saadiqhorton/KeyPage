import { useCallback } from "react";

import {
  changeMasterPassword,
  formatPasswordError,
} from "@/vault/master-password.js";
import { useRekeyBusy } from "@/vault/useRekeyBusy.js";

const ENTRY_SET_MISMATCH_MESSAGE =
  "Your key entries changed while the password was being updated. Nothing was saved — please try again.";

/**
 * Returns the new recovery codes rather than holding them: they belong in vault
 * wizard state, which survives this hook's component unmounting or locking.
 */
export function useChangeMasterPassword(): {
  busy: boolean;
  error: string | null;
  progress: string | null;
  changePassword(currentPassword: string, newPassword: string): Promise<string[]>;
  clearError(): void;
} {
  const { busy, error, progress, clearError, run } = useRekeyBusy();

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<string[]> =>
      run({
        fallback: "Password change failed.",
        onEntryMismatch: ENTRY_SET_MISMATCH_MESSAGE,
        formatError: formatPasswordError,
        run: (onProgress) =>
          changeMasterPassword(currentPassword, newPassword, onProgress),
      }),
    [run],
  );

  return {
    busy,
    error,
    progress,
    changePassword,
    clearError,
  };
}
