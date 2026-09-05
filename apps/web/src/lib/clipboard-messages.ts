import type { ClipboardWriteErrorReason } from "./clipboard.js";

export type ClipboardFailureContext = "keyEntry" | "recoveryCodes";

export function clipboardFailureMessage(
  reason: ClipboardWriteErrorReason,
  context: ClipboardFailureContext = "keyEntry",
): string {
  if (context === "recoveryCodes") {
    if (reason === "unavailable") {
      return "Clipboard needs a secure page. Open KeyPage over HTTPS or on localhost, or use Download again.";
    }
    return "Your browser blocked the clipboard. Allow clipboard access, or use Download again.";
  }

  if (reason === "unavailable") {
    return "Clipboard needs a secure page. Open KeyPage over HTTPS or on localhost, or reveal the key and copy it manually.";
  }
  return "Your browser blocked the clipboard. Allow clipboard access, or reveal the key and copy it manually.";
}
