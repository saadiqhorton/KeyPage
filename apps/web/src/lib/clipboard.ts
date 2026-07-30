/**
 * Copies text to the clipboard and schedules a best-effort clear after `clearAfterMs`.
 * Clearing is best-effort: we only clear when read access succeeds and the clipboard
 * still holds the same text. On read failure we skip clearing to avoid wiping unrelated
 * clipboard contents.
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
        // Read failed — skip clear rather than risk wiping unrelated clipboard data.
      }
    })();
  }, clearAfterMs);
}
