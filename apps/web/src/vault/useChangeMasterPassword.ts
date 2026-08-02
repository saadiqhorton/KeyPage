import { useCallback, useState } from "react";

import { ApiError } from "@/lib/api.js";
import {
  MasterPasswordError,
  changeMasterPassword,
} from "@/vault/master-password.js";

function formatPasswordError(error: unknown): string {
  if (error instanceof MasterPasswordError) {
    return error.message;
  }
  if (
    error instanceof ApiError &&
    error.code === "invalid_credentials" &&
    error.body.attemptsRemaining !== undefined
  ) {
    const remaining = error.body.attemptsRemaining;
    return `Incorrect Master Password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before a temporary lockout.`;
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Password change failed.";
}

export function useChangeMasterPassword(): {
  busy: boolean;
  error: string | null;
  progress: string | null;
  codes: string[] | null;
  changePassword(currentPassword: string, newPassword: string): Promise<string[]>;
  clearCodes(): void;
  clearError(): void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

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
        setCodes(result);
        return result;
      } catch (err) {
        const message = formatPasswordError(err);
        setError(message);
        throw err;
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [],
  );

  const clearCodes = useCallback(() => {
    setCodes(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    busy,
    error,
    progress,
    codes,
    changePassword,
    clearCodes,
    clearError,
  };
}
