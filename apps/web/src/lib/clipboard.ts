export type ClipboardAutoClearHandle = {
  cancel(): void;
  clearNow(): Promise<void>;
};

export function clearScheduledClipboardClear(timerId: number): void {
  window.clearTimeout(timerId);
}

/**
 * Fallback for environments where `navigator.clipboard.writeText` is denied or
 * does not sync to the OS pasteboard (some embedded browsers). Must run in a
 * user-gesture turn for best results.
 */
function writeTextViaExecCommand(text: string): void {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "0";
  el.style.width = "1px";
  el.style.height = "1px";
  el.style.padding = "0";
  el.style.border = "none";
  el.style.outline = "none";
  el.style.boxShadow = "none";
  el.style.background = "transparent";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  el.setSelectionRange(0, text.length);
  try {
    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("execCommand copy returned false");
    }
  } finally {
    el.remove();
  }
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to execCommand.
  }
  writeTextViaExecCommand(text);
}

async function clearClipboardIfUnchanged(text: string): Promise<void> {
  try {
    const current = await navigator.clipboard.readText();
    if (current === text) {
      await navigator.clipboard.writeText("");
    }
    return;
  } catch {
    // Read denied (common in embedded browsers). Still try to blank the
    // clipboard for the secret we know we wrote — best-effort only.
  }

  try {
    await navigator.clipboard.writeText("");
  } catch {
    try {
      writeTextViaExecCommand("");
    } catch {
      // Clear failed — leave clipboard alone rather than throw from a timer.
    }
  }
}

/**
 * Copies text to the clipboard and schedules a best-effort clear after `clearAfterMs`.
 * Prefer the Async Clipboard API; fall back to `document.execCommand('copy')`.
 * Clearing prefers a read-then-conditional wipe; if read is denied, attempts a blank write.
 */
export async function copyTextWithAutoClear(
  text: string,
  clearAfterMs: number,
): Promise<ClipboardAutoClearHandle> {
  await writeClipboardText(text);

  let cancelled = false;
  const timerId = window.setTimeout(() => {
    void (async () => {
      if (cancelled) {
        return;
      }
      await clearClipboardIfUnchanged(text);
    })();
  }, clearAfterMs);

  return {
    cancel() {
      cancelled = true;
      clearScheduledClipboardClear(timerId);
    },
    async clearNow() {
      cancelled = true;
      clearScheduledClipboardClear(timerId);
      await clearClipboardIfUnchanged(text);
    },
  };
}
