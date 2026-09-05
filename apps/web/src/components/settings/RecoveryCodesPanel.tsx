import { useCallback, useState } from "react";

import { RecoveryCodeGrid } from "@/components/RecoveryCodeGrid";
import { Button } from "@/components/ui/Button";
import { ClipboardWriteError, copyTextWithAutoClear } from "@/lib/clipboard.js";
import { clipboardFailureMessage } from "@/lib/clipboard-messages.js";
import { downloadRecoveryCodes } from "@/vault/recovery-download.js";
import { formatRecoveryCode } from "@keypage/shared";

type RecoveryCodesPanelProps = {
  codes: string[];
  onAcknowledged?(): void;
  acknowledgeLabel?: string;
};

export function RecoveryCodesPanel({
  codes,
  onAcknowledged,
  acknowledgeLabel = "I've saved my recovery codes somewhere safe.",
}: RecoveryCodesPanelProps) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const handleDownload = useCallback(() => {
    downloadRecoveryCodes(codes);
  }, [codes]);

  const handleCopyAll = useCallback(async () => {
    const text = codes.map((code) => formatRecoveryCode(code)).join("\n");
    try {
      await copyTextWithAutoClear(text, 30_000);
      setClipboardError(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopied(false);
      const reason =
        err instanceof ClipboardWriteError ? err.reason : "denied";
      setClipboardError(clipboardFailureMessage(reason, "recoveryCodes"));
    }
  }, [codes]);

  return (
    <div className="flex flex-col gap-4">
      <RecoveryCodeGrid codes={codes} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleDownload}>
          Download again
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void handleCopyAll()}
        >
          {copied ? "Copied" : "Copy all"}
        </Button>
      </div>
      {clipboardError ? (
        <p className="text-sm leading-relaxed text-muted">{clipboardError}</p>
      ) : null}
      {onAcknowledged ? (
        <>
          <label className="flex items-start gap-3 text-sm leading-relaxed text-muted">
            <input
              type="checkbox"
              className="mt-1 accent-brass"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
            />
            <span>{acknowledgeLabel}</span>
          </label>
          <Button
            type="button"
            disabled={!saved}
            onClick={() => {
              if (!saved) return;
              onAcknowledged();
            }}
          >
            Done
          </Button>
        </>
      ) : null}
    </div>
  );
}
