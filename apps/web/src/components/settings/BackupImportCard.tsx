import { FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { PasswordField } from "@/components/ui/PasswordField";
import { SettingsCard } from "@/components/settings/SettingsCard";
import {
  BackupFormatError,
  BackupPasswordError,
  parseBackupFile,
} from "@/crypto/backup.js";
import type { ImportOutcome } from "@/vault/useBackup";

type BackupImportCardProps = {
  busy: boolean;
  onImport: (fileText: string, password: string) => Promise<ImportOutcome>;
};

type ParsedBackupPreview = {
  fileName: string;
  createdAt: string;
};

export function BackupImportCard({ busy, onImport }: BackupImportCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedBackupPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportOutcome | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setParseError(null);
    setPreview(null);
    setFileText(null);
    setError(null);
    setResult(null);
    setPassword("");

    if (!file) {
      return;
    }

    const text = await file.text();
    try {
      const parsed = parseBackupFile(text);
      setFileText(text);
      setPreview({
        fileName: file.name,
        createdAt: parsed.createdAt,
      });
    } catch (err) {
      setParseError(
        err instanceof BackupFormatError
          ? err.message
          : "This file is not a valid KeyPage backup.",
      );
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!fileText) {
      setError("Choose a backup file to import.");
      return;
    }
    if (!password) {
      setError("Enter the Master Password for this backup.");
      return;
    }

    try {
      const outcome = await onImport(fileText, password);
      setPassword("");
      setResult(outcome);
    } catch (err) {
      setResult(null);
      if (err instanceof BackupPasswordError) {
        setError(`${err.message} Nothing was changed.`);
        return;
      }
      if (err instanceof BackupFormatError) {
        setError(err.message);
        return;
      }
      setError(err instanceof Error ? err.message : "Import failed.");
    }
  }

  return (
    <SettingsCard
      title="Import backup"
      description="Restore key entries from an encrypted backup file. Existing entries with the same ID are left unchanged."
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="backup-file" className="text-sm text-text">
          Backup file
        </label>
        <input
          ref={fileInputRef}
          id="backup-file"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => void handleFileChange(event)}
          className="block w-full cursor-pointer rounded-sm border border-hairline bg-obsidian/60 px-3 py-2 text-sm text-text file:mr-3 file:rounded-sm file:border-0 file:bg-brass/15 file:px-3 file:py-1 file:text-xs file:font-medium file:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      {parseError ? <Callout tone="danger">{parseError}</Callout> : null}

      {preview ? (
        <Callout tone="info">
          <span className="font-mono text-xs">{preview.fileName}</span>
          <span className="text-muted"> · created {preview.createdAt}</span>
        </Callout>
      ) : null}

      <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
        <PasswordField
          label="Master Password for this backup"
          hint="This may differ from the Master Password on this vault instance."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy || !fileText}
          error={error}
          autoComplete="current-password"
        />
        <div>
          <Button type="submit" loading={busy} disabled={!fileText}>
            Import backup
          </Button>
        </div>
      </form>

      {result ? (
        <Callout tone="info">
          {result.imported > 0 ? (
            <p>
              Restored {result.imported} key{" "}
              {result.imported === 1 ? "entry" : "entries"}.
            </p>
          ) : null}
          {result.skipped > 0 ? (
            <p>{result.skipped} were already in this vault.</p>
          ) : null}
        </Callout>
      ) : null}
    </SettingsCard>
  );
}
