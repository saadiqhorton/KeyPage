import type { KdfParams } from "./vault.js";
import type { KeyEntryCipherInput } from "./key-entries.js";

export const BACKUP_MAGIC = "keypage-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAX_ENTRIES = 500;
export const BACKUP_KDF_MAX_MEMORY_KIB = 262_144;
export const BACKUP_KDF_MAX_ARGON2ID_ITERATIONS = 10;
export const BACKUP_KDF_MAX_PBKDF2_ITERATIONS = 2_000_000;

/** Cleartext header + one opaque blob. Contains no plaintext key material. */
export type BackupFile = {
  magic: typeof BACKUP_MAGIC;
  formatVersion: number;
  createdAt: string;
  kdf: KdfParams;
  cipher: KeyEntryCipherInput;
};

/** Only ever exists in browser memory or inside BackupFile.cipher. */
export type BackupEntry = {
  id: string;
  label: string;
  serviceId: string;
  customServiceName: string | null;
  description: string | null;
  tags: string[];
  keyValue: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

export type BackupPayload = {
  formatVersion: number;
  createdAt: string;
  entryCount: number;
  entries: BackupEntry[];
};
