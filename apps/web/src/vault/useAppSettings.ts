import type { IdleTimeoutSource } from "@keypage/shared";
import { useCallback, useEffect, useState } from "react";

import { ApiError, getAppSettings, patchAppSettings } from "@/lib/api.js";

export function useAppSettings(): {
  loading: boolean;
  sessionIdleMinutes: number | null;
  sessionIdleSource: IdleTimeoutSource | null;
  saveBusy: boolean;
  error: string | null;
  success: boolean;
  setSessionIdleMinutes(minutes: number): void;
  save(): Promise<void>;
  clearSuccess(): void;
  clearError(): void;
} {
  const [loading, setLoading] = useState(true);
  const [sessionIdleMinutes, setSessionIdleMinutes] = useState<number | null>(
    null,
  );
  const [sessionIdleSource, setSessionIdleSource] =
    useState<IdleTimeoutSource | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const settings = await getAppSettings();
        if (cancelled) return;
        setSessionIdleMinutes(settings.sessionIdleMinutes);
        setSessionIdleSource(settings.sessionIdleSource);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Unable to load settings.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async () => {
    if (sessionIdleMinutes === null) {
      return;
    }

    setSaveBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const settings = await patchAppSettings({
        sessionIdleMinutes,
      });
      setSessionIdleMinutes(settings.sessionIdleMinutes);
      setSessionIdleSource(settings.sessionIdleSource);
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Unable to save settings.",
      );
      throw err;
    } finally {
      setSaveBusy(false);
    }
  }, [sessionIdleMinutes]);

  const clearSuccess = useCallback(() => {
    setSuccess(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    loading,
    sessionIdleMinutes,
    sessionIdleSource,
    saveBusy,
    error,
    success,
    setSessionIdleMinutes,
    save,
    clearSuccess,
    clearError,
  };
}
