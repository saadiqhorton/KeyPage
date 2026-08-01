import { useCallback, useEffect, useRef, useState } from "react";

type ToastTone = "default" | "danger";

type ToastState = {
  message: string;
  tone: ToastTone;
} | null;

export function useToast(defaultDurationMs = 2000): {
  toast: ToastState;
  showToast(message: string, tone?: ToastTone, durationMs?: number): void;
  clearToast(): void;
} {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearToast = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const showToast = useCallback(
    (message: string, tone: ToastTone = "default", durationMs?: number) => {
      clearTimer();
      setToast({ message, tone });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast(null);
      }, durationMs ?? defaultDurationMs);
    },
    [clearTimer, defaultDurationMs],
  );

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return { toast, showToast, clearToast };
}
