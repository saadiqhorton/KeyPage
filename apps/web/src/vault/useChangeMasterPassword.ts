import { useCallback, useState } from "react";

import {
  changeMasterPassword,
  formatPasswordError,
} from "@/vault/master-password.js";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<string[]> => {
      setBusy(true);
      setError(null);
      setProgress(null);
      try {
        const result = await changeMasterPassword(
          currentPassword,
          newPassword,
          setProgress,
        );
        return result;
      } catch (err) {
        const message = formatPasswordError(err, {
          fallback: "Password change failed.",
          onEntryMismatch: ENTRY_SET_MISMATCH_MESSAGE,
        });
        setError(message);
        throw err;
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    busy,
    error,
    progress,
    changePassword,
    clearError,
  };
}
