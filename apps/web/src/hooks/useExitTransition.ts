import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps the last non-null `value` mounted through an exit window after it
 * becomes null. Callers must pass a referentially stable `value` while the
 * content is showing (e.g. memoize object payloads) — a new object each
 * render retriggers the effect and can loop setState.
 */
export function useExitTransition<T>(
  value: T | null,
  exitMs: number,
): { rendered: T | null; closing: boolean } {
  const [rendered, setRendered] = useState<T | null>(value);
  const [closing, setClosing] = useState(false);
  const clearTimeoutRef = useRef<number | null>(null);
  const renderedRef = useRef<T | null>(value);

  useEffect(() => {
    renderedRef.current = rendered;
  }, [rendered]);

  useEffect(() => {
    const clearTimer = () => {
      if (clearTimeoutRef.current !== null) {
        window.clearTimeout(clearTimeoutRef.current);
        clearTimeoutRef.current = null;
      }
    };

    clearTimer();

    if (value !== null) {
      setRendered((prev) => (Object.is(prev, value) ? prev : value));
      setClosing((wasClosing) => (wasClosing ? false : wasClosing));
      return clearTimer;
    }

    if (renderedRef.current === null) {
      setRendered(null);
      setClosing(false);
      return clearTimer;
    }

    setClosing(true);
    clearTimeoutRef.current = window.setTimeout(
      () => {
        clearTimeoutRef.current = null;
        setRendered(null);
        setClosing(false);
      },
      prefersReducedMotion() ? 0 : exitMs + 40,
    );

    return clearTimer;
  }, [value, exitMs]);

  useEffect(() => {
    return () => {
      if (clearTimeoutRef.current !== null) {
        window.clearTimeout(clearTimeoutRef.current);
      }
    };
  }, []);

  return { rendered, closing };
}
