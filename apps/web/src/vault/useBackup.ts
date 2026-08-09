import {
  BACKUP_FORMAT_VERSION,
  type BackupEntry,
} from "@keypage/shared";
import { useCallback, useState } from "react";

import {
  BackupPasswordError,
  backupFileName,
  decryptBackup,
  encryptBackup,
  parseBackupFile,
  serializeBackupFile,
} from "@/crypto/backup.js";
import { deriveVaultKeys } from "@/crypto/derive.js";
import { decryptKeyValueWith } from "@/crypto/key-entry.js";
import { zeroize } from "@/crypto/provider.js";
import { getKeyEntries, getVaultStatus } from "@/lib/api.js";
import { downloadTextFile } from "@/lib/download.js";
import { useKeyEntryOperations } from "@/vault/useKeyEntryOperations.js";

export type ExportOutcome = { fileName: string; entryCount: number };
export type ImportOutcome = { imported: number; skipped: number };

export function useBackup(): {
  exportBusy: boolean;
  importBusy: boolean;
  exportBackup(password: string): Promise<ExportOutcome>;
  importBackup(fileText: string, password: string): Promise<ImportOutcome>;
} {
  const ops = useKeyEntryOperations();
  const [exportBusy, setExportBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);

  const exportBackup = useCallback(async (password: string): Promise<ExportOutcome> => {
    setExportBusy(true);
    try {
      const status = await getVaultStatus();
      if (status.kdf === null) {
        throw new Error("Vault is not initialized.");
      }

      const { entries } = await getKeyEntries();
      if (entries.length === 0) {
        throw new Error("There are no key entries to back up.");
      }

      const derived = await deriveVaultKeys(password, status.kdf);
      zeroize(derived.masterKey);

      const backupEntries: BackupEntry[] = [];
      for (const entry of entries) {
        try {
          const keyValue = await decryptKeyValueWith(derived.encryptionKey, entry);
          backupEntries.push({
            id: entry.id,
            label: entry.label,
            serviceId: entry.serviceId,
            customServiceName: entry.customServiceName,
            description: entry.description,
            tags: entry.tags,
            keyValue,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            lastUsedAt: entry.lastUsedAt,
          });
        } catch {
          throw new BackupPasswordError("That's not your Master Password.");
        }
      }

      const createdAt = new Date().toISOString();
      const payload = {
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt,
        entryCount: backupEntries.length,
        entries: backupEntries,
      };

      const file = await encryptBackup(password, payload);
      const fileName = backupFileName();
      downloadTextFile(fileName, serializeBackupFile(file), "application/json");

      return { fileName, entryCount: backupEntries.length };
    } finally {
      setExportBusy(false);
    }
  }, []);

  const importBackup = useCallback(
    async (fileText: string, password: string): Promise<ImportOutcome> => {
      setImportBusy(true);
      try {
        const file = parseBackupFile(fileText);
        const payload = await decryptBackup(file, password);

        const { entries: existingEntries } = await getKeyEntries();
        const existing = new Set(existingEntries.map((entry) => entry.id));
        const result = await ops.importEntries(payload.entries, existing);

        return {
          imported: result.imported,
          skipped:
            result.clientSkipped + result.skippedIds.length,
        };
      } finally {
        setImportBusy(false);
      }
    },
    [ops],
  );

  return {
    exportBusy,
    importBusy,
    exportBackup,
    importBackup,
  };
}
