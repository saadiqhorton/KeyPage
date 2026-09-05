import {
  AES_GCM_IV_BYTES,
  BACKUP_AAD_PREFIX,
  BACKUP_FORMAT_VERSION,
  BACKUP_KDF_MAX_ARGON2ID_ITERATIONS,
  BACKUP_KDF_MAX_MEMORY_KIB,
  BACKUP_KDF_MAX_PBKDF2_ITERATIONS,
  BACKUP_MAGIC,
  BACKUP_MAX_ENTRIES,
  DERIVED_KEY_BYTES,
  HKDF_INFO_BACKUP_KEY,
  isExportedBackupKdf,
  KDF_SALT_BYTES,
  KeyEntryFieldError,
  normalizeDescription,
  normalizeLabel,
  normalizeTags,
  resolveServiceForImport,
  validateService,
  type BackupFile,
  type BackupPayload,
  type KdfParams,
} from "@keypage/shared";

import { argon2idDerive } from "./argon2.js";
import { pickKdfParams } from "./derive.js";
import { base64Decode, base64Encode, utf8Bytes } from "./encoding.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  hkdfSha256,
  importAesKey,
  pbkdf2Sha256,
  randomBytes,
  zeroize,
  type AesKey,
} from "./provider.js";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BackupFormatError extends Error {}
export class BackupPasswordError extends Error {}

export function backupFileName(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `keypage-backup-${year}-${month}-${day}.json`;
}

export function backupAad(formatVersion: number): Uint8Array {
  return utf8Bytes(`${BACKUP_AAD_PREFIX}${formatVersion}`);
}

export function serializeBackupFile(file: BackupFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateKdfParams(kdf: KdfParams): void {
  const salt = base64Decode(kdf.saltB64);
  if (salt.length !== KDF_SALT_BYTES) {
    throw new BackupFormatError(`KDF salt must be ${KDF_SALT_BYTES} bytes`);
  }

  if (kdf.algorithm === "argon2id") {
    const memoryKiB = kdf.memoryKiB;
    const parallelism = kdf.parallelism;
    if (
      memoryKiB === undefined ||
      parallelism === undefined ||
      memoryKiB <= 0 ||
      memoryKiB > BACKUP_KDF_MAX_MEMORY_KIB
    ) {
      throw new BackupFormatError("KDF memoryKiB is out of allowed range");
    }
    if (
      kdf.iterations <= 0 ||
      kdf.iterations > BACKUP_KDF_MAX_ARGON2ID_ITERATIONS
    ) {
      throw new BackupFormatError("KDF iterations are out of allowed range");
    }
    return;
  }

  if (kdf.algorithm === "pbkdf2-sha256") {
    if (
      kdf.iterations <= 0 ||
      kdf.iterations > BACKUP_KDF_MAX_PBKDF2_ITERATIONS
    ) {
      throw new BackupFormatError("KDF iterations are out of allowed range");
    }
    return;
  }

  throw new BackupFormatError("Unsupported KDF algorithm");
}

/**
 * Gate for the UNTRUSTED import path: same shape/sanity checks as
 * `validateKdfParams`, then pins the header KDF to the exact presets KeyPage
 * export has ever emitted so a hostile file cannot force heavy derivation.
 */
function validateImportedKdfParams(kdf: KdfParams): void {
  validateKdfParams(kdf);
  if (!isExportedBackupKdf(kdf)) {
    throw new BackupFormatError(
      "Backup KDF settings don't match a KeyPage export. Re-export the backup from KeyPage and try again.",
    );
  }
}

function parseKdfParams(value: unknown): KdfParams {
  if (!isRecord(value)) {
    throw new BackupFormatError("Invalid KDF parameters");
  }

  const algorithm = value.algorithm;
  const saltB64 = value.saltB64;
  const iterations = value.iterations;

  if (algorithm !== "argon2id" && algorithm !== "pbkdf2-sha256") {
    throw new BackupFormatError("Unsupported KDF algorithm");
  }
  if (typeof saltB64 !== "string") {
    throw new BackupFormatError("Invalid KDF salt");
  }
  if (typeof iterations !== "number" || !Number.isInteger(iterations)) {
    throw new BackupFormatError("Invalid KDF iterations");
  }

  if (algorithm === "argon2id") {
    const memoryKiB = value.memoryKiB;
    const parallelism = value.parallelism;
    if (typeof memoryKiB !== "number" || !Number.isInteger(memoryKiB)) {
      throw new BackupFormatError("Invalid KDF memoryKiB");
    }
    if (typeof parallelism !== "number" || !Number.isInteger(parallelism)) {
      throw new BackupFormatError("Invalid KDF parallelism");
    }
    return {
      algorithm,
      saltB64,
      iterations,
      memoryKiB,
      parallelism,
    };
  }

  return {
    algorithm,
    saltB64,
    iterations,
  };
}

function parseCipherInput(value: unknown): BackupFile["cipher"] {
  if (!isRecord(value)) {
    throw new BackupFormatError("Invalid cipher");
  }

  const algorithm = value.algorithm;
  const ivB64 = value.ivB64;
  const ciphertextB64 = value.ciphertextB64;

  if (algorithm !== "aes-256-gcm") {
    throw new BackupFormatError("Invalid cipher algorithm");
  }
  if (typeof ivB64 !== "string") {
    throw new BackupFormatError("Invalid cipher ivB64");
  }
  if (typeof ciphertextB64 !== "string") {
    throw new BackupFormatError("Invalid cipher ciphertextB64");
  }

  return {
    algorithm,
    ivB64,
    ciphertextB64,
  };
}

export function parseBackupFile(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupFormatError("Backup file is not valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new BackupFormatError("Backup file must be a JSON object");
  }

  if (parsed.magic !== BACKUP_MAGIC) {
    throw new BackupFormatError("Invalid backup magic");
  }

  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError("Unsupported backup format version");
  }

  if (typeof parsed.createdAt !== "string") {
    throw new BackupFormatError("Invalid backup createdAt");
  }

  const kdf = parseKdfParams(parsed.kdf);
  validateImportedKdfParams(kdf);
  const cipher = parseCipherInput(parsed.cipher);

  return {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: parsed.createdAt,
    kdf,
    cipher,
  };
}

function isUuidV4(id: string): boolean {
  return UUID_V4_PATTERN.test(id);
}

function validateBackupEntry(entry: unknown, index: number): void {
  if (!isRecord(entry)) {
    throw new BackupFormatError(`Entry ${index} is invalid`);
  }

  const id = entry.id;
  const label = entry.label;
  const serviceId = entry.serviceId;
  const customServiceName = entry.customServiceName;
  const description = entry.description;
  const tags = entry.tags;
  const keyValue = entry.keyValue;
  const createdAt = entry.createdAt;
  const updatedAt = entry.updatedAt;
  const lastUsedAt = entry.lastUsedAt;

  if (typeof id !== "string" || !isUuidV4(id)) {
    throw new BackupFormatError(`Entry ${index} has an invalid id`);
  }
  if (typeof label !== "string") {
    throw new BackupFormatError(`Entry ${index} has an invalid label`);
  }
  if (typeof serviceId !== "string" || serviceId.length === 0) {
    throw new BackupFormatError(`Entry ${index} has an invalid serviceId`);
  }
  if (
    customServiceName !== null &&
    typeof customServiceName !== "string"
  ) {
    throw new BackupFormatError(
      `Entry ${index} has an invalid customServiceName`,
    );
  }
  if (description !== null && typeof description !== "string") {
    throw new BackupFormatError(`Entry ${index} has an invalid description`);
  }
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new BackupFormatError(`Entry ${index} has invalid tags`);
  }

  try {
    normalizeLabel(label);
    normalizeDescription(description === null ? undefined : description);
    normalizeTags(tags);
    const resolved = resolveServiceForImport(
      serviceId,
      customServiceName,
    );
    validateService(resolved.serviceId, resolved.customServiceName);
  } catch (error) {
    if (error instanceof KeyEntryFieldError) {
      const field = error.details[0]?.field ?? "fields";
      throw new BackupFormatError(
        `Entry ${index} has invalid ${field}`,
      );
    }
    throw error;
  }

  if (typeof keyValue !== "string" || keyValue.length === 0) {
    throw new BackupFormatError(`Entry ${index} has an invalid keyValue`);
  }
  if (typeof createdAt !== "string") {
    throw new BackupFormatError(`Entry ${index} has an invalid createdAt`);
  }
  if (typeof updatedAt !== "string") {
    throw new BackupFormatError(`Entry ${index} has an invalid updatedAt`);
  }
  if (lastUsedAt !== null && typeof lastUsedAt !== "string") {
    throw new BackupFormatError(`Entry ${index} has an invalid lastUsedAt`);
  }
}

export function validateBackupPayload(value: unknown): BackupPayload {
  if (!isRecord(value)) {
    throw new BackupFormatError("Backup payload must be an object");
  }

  const formatVersion = value.formatVersion;
  const createdAt = value.createdAt;
  const entryCount = value.entryCount;
  const entries = value.entries;

  if (formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError("Unsupported backup payload format version");
  }
  if (typeof createdAt !== "string") {
    throw new BackupFormatError("Invalid backup payload createdAt");
  }
  if (typeof entryCount !== "number" || !Number.isInteger(entryCount)) {
    throw new BackupFormatError("Invalid backup payload entryCount");
  }
  if (!Array.isArray(entries)) {
    throw new BackupFormatError("Invalid backup payload entries");
  }
  if (entryCount !== entries.length) {
    throw new BackupFormatError("Backup payload entryCount mismatch");
  }
  if (entries.length > BACKUP_MAX_ENTRIES) {
    throw new BackupFormatError("Backup payload has too many entries");
  }

  for (let i = 0; i < entries.length; i++) {
    validateBackupEntry(entries[i], i);
  }

  return {
    formatVersion,
    createdAt,
    entryCount,
    entries: entries as BackupPayload["entries"],
  };
}

export async function deriveBackupKey(
  password: string,
  kdf: KdfParams,
): Promise<AesKey> {
  validateKdfParams(kdf);

  const salt = base64Decode(kdf.saltB64);
  let masterKey: Uint8Array;
  if (kdf.algorithm === "argon2id") {
    masterKey = await argon2idDerive({
      password,
      salt,
      memoryKiB: kdf.memoryKiB!,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism!,
      hashLength: DERIVED_KEY_BYTES,
    });
  } else {
    masterKey = await pbkdf2Sha256(
      password,
      salt,
      kdf.iterations,
      DERIVED_KEY_BYTES,
    );
  }

  const backupKeyRaw = await hkdfSha256(
    masterKey,
    salt,
    HKDF_INFO_BACKUP_KEY,
    DERIVED_KEY_BYTES,
  );
  zeroize(masterKey);

  const backupKey = await importAesKey(backupKeyRaw);
  zeroize(backupKeyRaw);
  return backupKey;
}

export async function encryptBackup(
  password: string,
  payload: BackupPayload,
  kdf?: KdfParams,
): Promise<BackupFile> {
  const resolvedKdf = kdf ?? (await pickKdfParams());
  validateKdfParams(resolvedKdf);

  const createdAt = payload.createdAt;
  const key = await deriveBackupKey(password, resolvedKdf);
  const plaintext = utf8Bytes(JSON.stringify(payload));
  const iv = randomBytes(AES_GCM_IV_BYTES);

  try {
    const ciphertext = await aesGcmEncrypt(
      key,
      iv,
      backupAad(BACKUP_FORMAT_VERSION),
      plaintext,
    );

    return {
      magic: BACKUP_MAGIC,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt,
      kdf: resolvedKdf,
      cipher: {
        algorithm: "aes-256-gcm",
        ivB64: base64Encode(iv),
        ciphertextB64: base64Encode(ciphertext),
      },
    };
  } finally {
    zeroize(plaintext);
  }
}

export async function decryptBackup(
  file: BackupFile,
  password: string,
): Promise<BackupPayload> {
  validateImportedKdfParams(file.kdf);

  const key = await deriveBackupKey(password, file.kdf);
  const iv = base64Decode(file.cipher.ivB64);
  const ciphertext = base64Decode(file.cipher.ciphertextB64);

  let plaintext: Uint8Array;
  try {
    plaintext = await aesGcmDecrypt(
      key,
      iv,
      backupAad(file.formatVersion),
      ciphertext,
    );
  } catch {
    throw new BackupPasswordError(
      "That password does not unlock this backup file.",
    );
  }

  try {
    const decoded = new TextDecoder().decode(plaintext);
    return validateBackupPayload(JSON.parse(decoded));
  } catch (error) {
    if (error instanceof BackupFormatError) {
      throw error;
    }
    throw new BackupFormatError("Backup payload is invalid");
  } finally {
    zeroize(plaintext);
  }
}
