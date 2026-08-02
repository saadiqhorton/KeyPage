import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { PasswordField } from "@/components/ui/PasswordField";
import type { ExportOutcome } from "@/vault/useBackup";

type BackupExportCardProps = {
  entryCount: number;
  busy: boolean;
  onExport: (password: string) => Promise<ExportOutcome>;
};

export function BackupExportCard({
  entryCount,
  busy,
  onExport,
}: BackupExportCardProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<ExportOutcome | null>(null);
  const disabled = entryCount === 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!password) {
      setError("Enter your Master Password to export a backup.");
      return;
    }

    try {
      const outcome = await onExport(password);
      setPassword("");
      setSuccess(outcome);
    } catch (err) {
      setSuccess(null);
      setError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-sm border border-hairline bg-surface/40 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-text">Export backup</h3>
        <p className="text-xs text-muted">
          Download an encrypted copy of every key entry in this vault.
        </p>
      </div>

      <Callout tone="warning">
        This file contains every API key in this vault. It is encrypted with your
        Master Password — store it offline.
      </Callout>

      {disabled ? (
        <p className="text-sm text-muted">Nothing to back up yet.</p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <PasswordField
            label="Master Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            error={error}
            autoComplete="current-password"
          />
          <div>
            <Button type="submit" loading={busy} disabled={disabled}>
              Export backup
            </Button>
          </div>
        </form>
      )}

      {success ? (
        <Callout tone="info">
          Saved <span className="font-mono text-xs">{success.fileName}</span> with{" "}
          {success.entryCount} key {success.entryCount === 1 ? "entry" : "entries"}.
        </Callout>
      ) : null}
    </div>
  );
}
