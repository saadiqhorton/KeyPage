import {
  BACKUP_FORMAT_VERSION,
  SERVICE_CATALOG,
  type BackupEntry,
  type KeyEntryImportItem,
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
import {
  decryptKeyValueWith,
  encryptKeyValue,
} from "@/crypto/key-entry.js";
import { zeroize } from "@/crypto/provider.js";
import { getKeyEntries, getVaultStatus, postKeyEntryImport } from "@/lib/api.js";
import { downloadTextFile } from "@/lib/download.js";

export type ExportOutcome = { fileName: string; entryCount: number };
export type ImportOutcome = { imported: number; skipped: number };

const catalogIds = new Set<string>(SERVICE_CATALOG.map((service) => service.id));

function normalizeService(entry: BackupEntry): {
  serviceId: string;
  customServiceName?: string;
} {
  if (catalogIds.has(entry.serviceId)) {
    return {
      serviceId: entry.serviceId,
      ...(entry.customServiceName
        ? { customServiceName: entry.customServiceName }
        : {}),
    };
  }
  return {
    serviceId: "custom",
    customServiceName: entry.customServiceName ?? entry.serviceId,
  };
}

export function useBackup(): {
  exportBusy: boolean;
  importBusy: boolean;
  exportBackup(password: string): Promise<ExportOutcome>;
  importBackup(fileText: string, password: string): Promise<ImportOutcome>;
} {
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
        const candidates = payload.entries.filter((entry) => !existing.has(entry.id));

        if (candidates.length === 0) {
          return { imported: 0, skipped: payload.entries.length };
        }

        const importItems: KeyEntryImportItem[] = [];
        for (const entry of candidates) {
          const cipher = await encryptKeyValue(entry.id, entry.keyValue);
          const { serviceId, customServiceName } = normalizeService(entry);
          importItems.push({
            id: entry.id,
            label: entry.label,
            serviceId,
            customServiceName,
            description: entry.description ?? undefined,
            tags: entry.tags,
            cipher,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            lastUsedAt: entry.lastUsedAt,
          });
        }

        const response = await postKeyEntryImport({ entries: importItems });

        return {
          imported: response.imported,
          skipped:
            payload.entries.length -
            candidates.length +
            response.skippedIds.length,
        };
      } finally {
        setImportBusy(false);
      }
    },
    [],
  );

  return {
    exportBusy,
    importBusy,
    exportBackup,
    importBackup,
  };
}
