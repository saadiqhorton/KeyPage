/**
 * Copies text to the clipboard and schedules a best-effort clear after `clearAfterMs`.
 * Clearing is best-effort: if read access is available we only clear when the
 * clipboard still holds the same text; otherwise we attempt `writeText("")`.
 */
export async function copyTextWithAutoClear(
  text: string,
  clearAfterMs: number,
): Promise<void> {
  await navigator.clipboard.writeText(text);

  window.setTimeout(() => {
    void (async () => {
      try {
        const current = await navigator.clipboard.readText();
        if (current === text) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        try {
          await navigator.clipboard.writeText("");
        } catch {
          // Clipboard clear is best-effort only.
        }
      }
    })();
  }, clearAfterMs);
}
