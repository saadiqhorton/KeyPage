import {
  ARGON2ID_VAULT_PARAMS,
  PBKDF2_FALLBACK_ITERATIONS,
  type KdfParams,
} from "./vault.js";
import type { KeyEntryCipherPayload } from "./key-entries.js";

export const BACKUP_MAGIC = "keypage-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAX_ENTRIES = 500;
/**
 * Shape/sanity bounds for self-generated KDF params (encrypt path). Import
 * additionally pins the cleartext header KDF to the exact presets KeyPage
 * export has ever emitted (see `isExportedBackupKdf`).
 */
export const BACKUP_KDF_MAX_MEMORY_KIB = 262_144;
export const BACKUP_KDF_MAX_ARGON2ID_ITERATIONS = 10;
export const BACKUP_KDF_MAX_PBKDF2_ITERATIONS = 2_000_000;

/** True only for KDF params a KeyPage export has ever emitted (v1). */
export function isExportedBackupKdf(kdf: KdfParams): boolean {
  if (kdf.algorithm === "argon2id") {
    return (
      kdf.memoryKiB === ARGON2ID_VAULT_PARAMS.memoryKiB &&
      kdf.iterations === ARGON2ID_VAULT_PARAMS.iterations &&
      kdf.parallelism === ARGON2ID_VAULT_PARAMS.parallelism
    );
  }
  return kdf.iterations === PBKDF2_FALLBACK_ITERATIONS;
}

/** Cleartext header + one opaque blob. Contains no plaintext key material. */
export type BackupFile = {
  magic: typeof BACKUP_MAGIC;
  formatVersion: number;
  createdAt: string;
  kdf: KdfParams;
  /** Sealed with the backup password, not the vault key, so no `keyVersion` applies. */
  cipher: KeyEntryCipherPayload;
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
