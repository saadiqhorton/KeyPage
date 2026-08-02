import type { ReencryptedKeyEntry } from "@keypage/shared";

import { deriveVaultKeys, pickKdfParams } from "@/crypto/derive.js";
import {
  decryptKeyValueWith,
  encryptKeyValueWith,
} from "@/crypto/key-entry.js";
import { zeroize, zeroizeAesKey } from "@/crypto/provider.js";
import { buildRecoveryCodeEnvelopes } from "@/crypto/recovery.js";
import {
  ApiError,
  getKeyEntries,
  getVaultStatus,
  postRecoveryCodesRegenerate,
  postVaultPasswordChange,
} from "@/lib/api.js";

import { downloadRecoveryCodes } from "./recovery-download.js";
import { replaceEncryptionKey } from "./session-keys.js";

export class MasterPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterPasswordError";
  }
}

export type PasswordChangeProgress = (label: string) => void;

export async function changeMasterPassword(
  currentPassword: string,
  newPassword: string,
  onProgress?: PasswordChangeProgress,
): Promise<string[]> {
  onProgress?.("Checking vault status…");
  const status = await getVaultStatus();
  if (!status.kdf) {
    throw new Error("Vault is not initialized.");
  }

  onProgress?.("Verifying current Master Password…");
  const current = await deriveVaultKeys(currentPassword, status.kdf);
  zeroize(current.masterKey);

  onProgress?.("Loading key entries…");
  const { entries } = await getKeyEntries();

  const decrypted: Array<{ id: string; plaintext: string }> = [];
  if (entries.length > 0) {
    onProgress?.("Verifying encryption key…");
    try {
      await decryptKeyValueWith(current.encryptionKey, entries[0]!);
    } catch {
      zeroizeAesKey(current.encryptionKey);
      throw new MasterPasswordError("That's not your Master Password.");
    }

    onProgress?.("Decrypting key entries…");
    for (const entry of entries) {
      try {
        const plaintext = await decryptKeyValueWith(current.encryptionKey, entry);
        decrypted.push({ id: entry.id, plaintext });
      } catch {
        zeroizeAesKey(current.encryptionKey);
        throw new MasterPasswordError("That's not your Master Password.");
      }
    }
  }
  zeroizeAesKey(current.encryptionKey);

  onProgress?.("Deriving new encryption key…");
  const kdf = await pickKdfParams();
  const next = await deriveVaultKeys(newPassword, kdf);

  onProgress?.("Re-encrypting key entries…");
  const reencrypted: ReencryptedKeyEntry[] = [];
  for (const item of decrypted) {
    const cipher = await encryptKeyValueWith(
      next.encryptionKey,
      item.id,
      item.plaintext,
    );
    reencrypted.push({ id: item.id, cipher });
  }

  onProgress?.("Generating recovery codes…");
  const { codes, envelopes } = await buildRecoveryCodeEnvelopes(next.masterKey);
  zeroize(next.masterKey);

  onProgress?.("Saving new Master Password…");
  try {
    await postVaultPasswordChange({
      currentAuthKeyB64: current.authKeyB64,
      kdf,
      authKeyB64: next.authKeyB64,
      recoveryCodes: envelopes,
      entries: reencrypted,
    });
  } catch (error) {
    zeroizeAesKey(next.encryptionKey);
    if (
      error instanceof ApiError &&
      error.code === "invalid_credentials"
    ) {
      throw new MasterPasswordError("That's not your Master Password.");
    }
    throw error;
  }

  replaceEncryptionKey(next.encryptionKey);
  downloadRecoveryCodes(codes);
  return codes;
}

export async function regenerateRecoveryCodes(
  password: string,
): Promise<string[]> {
  const status = await getVaultStatus();
  if (!status.kdf) {
    throw new Error("Vault is not initialized.");
  }

  const derived = await deriveVaultKeys(password, status.kdf);
  zeroizeAesKey(derived.encryptionKey);

  const { codes, envelopes } = await buildRecoveryCodeEnvelopes(derived.masterKey);
  zeroize(derived.masterKey);

  try {
    await postRecoveryCodesRegenerate({
      authKeyB64: derived.authKeyB64,
      recoveryCodes: envelopes,
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "invalid_credentials"
    ) {
      throw new MasterPasswordError("That's not your Master Password.");
    }
    throw error;
  }

  downloadRecoveryCodes(codes);
  return codes;
}
