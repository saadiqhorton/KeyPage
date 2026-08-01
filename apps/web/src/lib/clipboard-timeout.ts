import {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
} from "@keypage/shared";

export {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
};

/**
 * Converts server-provided clipboard clear seconds to milliseconds, applying
 * the same default and clamp bounds as the API resolver.
 */
export function resolveClipboardClearMs(
  secondsFromServer: number | null | undefined,
): number {
  let seconds = secondsFromServer;
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    seconds = DEFAULT_CLIPBOARD_CLEAR_SECONDS;
  } else {
    seconds = Math.min(
      CLIPBOARD_CLEAR_SECONDS_MAX,
      Math.max(CLIPBOARD_CLEAR_SECONDS_MIN, seconds),
    );
  }
  return seconds * 1000;
}
