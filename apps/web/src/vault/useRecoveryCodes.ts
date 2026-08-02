import { useCallback, useEffect, useState } from "react";

import { ApiError, getVaultStatus } from "@/lib/api.js";
import {
  MasterPasswordError,
  regenerateRecoveryCodes,
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
  return "Recovery code regeneration failed.";
}

export function useRecoveryCodes(): {
  remaining: number | null;
  loadingRemaining: boolean;
  busy: boolean;
  error: string | null;
  codes: string[] | null;
  refreshRemaining(): Promise<void>;
  regenerate(password: string): Promise<string[]>;
  clearCodes(): void;
  clearError(): void;
} {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadingRemaining, setLoadingRemaining] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

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

  const regenerate = useCallback(async (password: string): Promise<string[]> => {
    setBusy(true);
    setError(null);
    try {
      const result = await regenerateRecoveryCodes(password);
      setCodes(result);
      setRemaining(result.length);
      return result;
    } catch (err) {
      const message = formatPasswordError(err);
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearCodes = useCallback(() => {
    setCodes(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    remaining,
    loadingRemaining,
    busy,
    error,
    codes,
    refreshRemaining,
    regenerate,
    clearCodes,
    clearError,
  };
}
