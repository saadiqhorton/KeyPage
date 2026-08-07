import {
  AES_GCM_IV_BYTES,
  KEY_ENTRY_AAD_PREFIX,
  type KeyEntry,
  type KeyEntryCipherInput,
  type KeyEntryCipherPayload,
} from "@keypage/shared";

import { base64Decode, base64Encode, hexEncode, utf8Bytes } from "./encoding.js";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  randomBytes,
  zeroize,
  type AesKey,
} from "./provider.js";
import {
  getEncryptionKey,
  getEncryptionKeyVersion,
} from "@/vault/session-keys.js";

export function newKeyEntryId(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = hexEncode(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function keyEntryAad(id: string): Uint8Array {
  return utf8Bytes(`${KEY_ENTRY_AAD_PREFIX}${id}`);
}

/**
 * Version-free: used by rotation, where the server mints the new key version in
 * the same transaction that stores the ciphertext.
 */
export async function encryptKeyValueWith(
  key: AesKey,
  id: string,
  keyValue: string,
): Promise<KeyEntryCipherPayload> {
  const plaintextBytes = utf8Bytes(keyValue);
  const iv = randomBytes(AES_GCM_IV_BYTES);
  try {
    const ciphertext = await aesGcmEncrypt(
      key,
      iv,
      keyEntryAad(id),
      plaintextBytes,
    );
    return {
      algorithm: "aes-256-gcm",
      ivB64: base64Encode(iv),
      ciphertextB64: base64Encode(ciphertext),
    };
  } finally {
    zeroize(plaintextBytes);
  }
}

export async function decryptKeyValueWith(
  key: AesKey,
  entry: Pick<KeyEntry, "id" | "cipher">,
): Promise<string> {
  const iv = base64Decode(entry.cipher.ivB64);
  const ciphertext = base64Decode(entry.cipher.ciphertextB64);
  const plaintextBytes = await aesGcmDecrypt(
    key,
    iv,
    keyEntryAad(entry.id),
    ciphertext,
  );
  try {
    return new TextDecoder().decode(plaintextBytes);
  } finally {
    zeroize(plaintextBytes);
  }
}

/**
 * Ordinary writes declare the key version the unlocked key belongs to, so the
 * server can reject ciphertext from a tab that missed a rotation.
 */
export async function encryptKeyValue(
  id: string,
  keyValue: string,
): Promise<KeyEntryCipherInput> {
  const key = getEncryptionKey();
  const keyVersion = getEncryptionKeyVersion();
  if (key === null || keyVersion === null) {
    throw new Error("Vault is locked");
  }

  return { ...(await encryptKeyValueWith(key, id, keyValue)), keyVersion };
}

export async function decryptKeyValue(entry: KeyEntry): Promise<string> {
  const key = getEncryptionKey();
  if (key === null) {
    throw new Error("Vault is locked");
  }

  return decryptKeyValueWith(key, entry);
}
