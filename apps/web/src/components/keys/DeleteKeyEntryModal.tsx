import type { KeyEntry } from "@keypage/shared";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Modal } from "@/components/ui/Modal";
import { ServiceIcon } from "@/components/ui/ServiceIcon";
import { ApiError } from "@/lib/api";
import { serviceDisplayName } from "@/lib/key-entry-filter";

type Props = {
  entry: KeyEntry | null;
  onConfirm(entry: KeyEntry): Promise<unknown>;
  onClose(): void;
};

export function DeleteKeyEntryModal({ entry, onConfirm, onClose }: Readonly<Props>) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const snapshotRef = useRef<KeyEntry | null>(null);

  if (entry !== null) {
    snapshotRef.current = entry;
  }

  const displayEntry = entry ?? snapshotRef.current;

  useEffect(() => {
    if (entry !== null) {
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [entry]);

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  async function handleConfirm() {
    if (!displayEntry) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      await onConfirm(displayEntry);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to delete key entry.";
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!displayEntry) return null;

  const displayName = serviceDisplayName(displayEntry);

  return (
    <Modal
      open={entry !== null}
      onClose={handleClose}
      eyebrow="Vault"
      title="Delete Key Entry"
      description="This permanently removes the key entry from your vault. This action cannot be undone."
      busy={submitting}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={submitting}
            onClick={() => void handleConfirm()}
          >
            Delete Key Entry
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {submitError ? (
          <Callout tone="danger">{submitError}</Callout>
        ) : null}

        <div className="flex items-center gap-3 rounded-sm border border-hairline bg-surface/40 px-4 py-3">
          <ServiceIcon serviceId={displayEntry.serviceId} size="md" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {displayName}
            </p>
            <p className="mt-0.5 truncate font-display text-base font-medium text-text">
              {displayEntry.label}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
