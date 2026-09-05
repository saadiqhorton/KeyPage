export type ClipboardAutoClearHandle = {
  cancel(): void;
  clearNow(): Promise<void>;
};

export type ClipboardWriteErrorReason = "unavailable" | "denied";

export class ClipboardWriteError extends Error {
  readonly reason: ClipboardWriteErrorReason;

  constructor(reason: ClipboardWriteErrorReason, message?: string) {
    super(message ?? reason);
    this.name = "ClipboardWriteError";
    this.reason = reason;
  }
}

export type ClipboardApi = {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
};

export type ClipboardEnv = {
  clipboard: ClipboardApi | undefined;
  isSecureContext: boolean;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

export type ClipboardCopier = {
  copyTextWithAutoClear(
    text: string,
    clearAfterMs: number,
  ): Promise<ClipboardAutoClearHandle>;
};

export function clearScheduledClipboardClear(timerId: number): void {
  window.clearTimeout(timerId);
}

async function writeClipboardText(
  env: ClipboardEnv,
  text: string,
): Promise<void> {
  if (typeof env.clipboard?.writeText !== "function") {
    throw new ClipboardWriteError("unavailable");
  }
  try {
    await env.clipboard.writeText(text);
  } catch {
    throw new ClipboardWriteError(env.isSecureContext ? "denied" : "unavailable");
  }
}

async function clearClipboardIfUnchanged(
  env: ClipboardEnv,
  text: string,
): Promise<void> {
  if (typeof env.clipboard?.writeText !== "function") {
    return;
  }

  let shouldBlank = false;
  try {
    const current = await env.clipboard.readText();
    shouldBlank = current === text;
  } catch {
    // Read denied — still try to blank the clipboard for the secret we wrote.
    shouldBlank = true;
  }

  if (!shouldBlank) {
    return;
  }

  try {
    await env.clipboard.writeText("");
  } catch {
    // Clear failed — leave clipboard alone rather than throw from a timer.
  }
}

export function createClipboardCopier(env: ClipboardEnv): ClipboardCopier {
  return {
    async copyTextWithAutoClear(text, clearAfterMs) {
      await writeClipboardText(env, text);

      let cancelled = false;
      const timerId = env.setTimeout(() => {
        void (async () => {
          if (cancelled) {
            return;
          }
          await clearClipboardIfUnchanged(env, text);
        })();
      }, clearAfterMs);

      return {
        cancel() {
          cancelled = true;
          env.clearTimeout(timerId);
        },
        async clearNow() {
          cancelled = true;
          env.clearTimeout(timerId);
          await clearClipboardIfUnchanged(env, text);
        },
      };
    },
  };
}

const browserClipboardEnv: ClipboardEnv = {
  get clipboard() {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.clipboard?.writeText === "function"
    ) {
      return {
        writeText: (text: string) => navigator.clipboard.writeText(text),
        readText: () => navigator.clipboard.readText(),
      };
    }
    return undefined;
  },
  isSecureContext:
    typeof globalThis !== "undefined" && "isSecureContext" in globalThis
      ? Boolean(globalThis.isSecureContext)
      : false,
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

const defaultCopier = createClipboardCopier(browserClipboardEnv);

/**
 * Copies text to the clipboard and schedules a best-effort clear after `clearAfterMs`.
 * Requires the Async Clipboard API (secure context). Fails closed when unavailable or denied.
 */
export async function copyTextWithAutoClear(
  text: string,
  clearAfterMs: number,
): Promise<ClipboardAutoClearHandle> {
  return defaultCopier.copyTextWithAutoClear(text, clearAfterMs);
}
