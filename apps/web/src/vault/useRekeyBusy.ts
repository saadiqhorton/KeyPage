import { useCallback, useState } from "react";

export type RekeyBusyState = {
  busy: boolean;
  error: string | null;
  progress: string | null;
  clearError(): void;
};

export type RunRekeyOperationOptions<T> = {
  fallback: string;
  onEntryMismatch?: string;
  formatError(error: unknown, options: { fallback: string; onEntryMismatch?: string }): string;
  run(onProgress: (label: string) => void): Promise<T>;
};

/**
 * Shared busy/error/progress handoff for client rekey drivers invoked from Settings.
 */
export function useRekeyBusy(): RekeyBusyState & {
  run<T>(options: RunRekeyOperationOptions<T>): Promise<T>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const run = useCallback(
    async <T>(options: RunRekeyOperationOptions<T>): Promise<T> => {
      setBusy(true);
      setError(null);
      setProgress(null);
      try {
        return await options.run(setProgress);
      } catch (err) {
        const message = options.formatError(err, {
          fallback: options.fallback,
          onEntryMismatch: options.onEntryMismatch,
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

  return {
    busy,
    error,
    progress,
    clearError,
    run,
  };
}
