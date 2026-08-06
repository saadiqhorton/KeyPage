import type {
  ReencryptedKeyEntry,
  VaultPasswordChangeResponse,
} from "@keypage/shared";

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

function isEntrySetMismatch(error: ApiError): boolean {
  if (error.code !== "invalid_request") {
    return false;
  }
  if (error.message === "Entry set does not match vault") {
    return true;
  }
  return (error.body.details ?? []).some(
    (detail) => detail.field === "entries",
  );
}

function rethrowInvalidCredentials(error: unknown): never {
  if (error instanceof ApiError && error.code === "invalid_credentials") {
    throw new MasterPasswordError("That's not your Master Password.");
  }
  throw error;
}

export function formatPasswordError(
  error: unknown,
  options?: {
    fallback?: string;
    onEntryMismatch?: string;
  },
): string {
  if (error instanceof MasterPasswordError) {
    return error.message;
  }
  if (
    error instanceof ApiError &&
    error.code === "invalid_credentials" &&
    error.body.attemptsRemaining !== undefined
  ) {
    const remaining = error.body.attemptsRemaining;
    return `Incorrect Master Password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before a temporary lockout.`;
  }
  if (
    options?.onEntryMismatch &&
    error instanceof ApiError &&
    isEntrySetMismatch(error)
  ) {
    return options.onEntryMismatch;
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return options?.fallback ?? "Something went wrong.";
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
    onProgress?.("Decrypting key entries…");
    let firstFailedEntry: { label: string; id: string } | undefined;
    for (const entry of entries) {
      try {
        const plaintext = await decryptKeyValueWith(current.encryptionKey, entry);
        decrypted.push({ id: entry.id, plaintext });
      } catch {
        if (!firstFailedEntry) {
          firstFailedEntry = { label: entry.label, id: entry.id };
        }
      }
    }

    if (decrypted.length === 0) {
      zeroizeAesKey(current.encryptionKey);
      throw new MasterPasswordError("That's not your Master Password.");
    }
    if (firstFailedEntry) {
      zeroizeAesKey(current.encryptionKey);
      throw new MasterPasswordError(
        `“${firstFailedEntry.label}” (${firstFailedEntry.id}) could not be decrypted, so nothing was changed. Check that key entry and try again.`,
      );
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
  let response: VaultPasswordChangeResponse;
  try {
    response = await postVaultPasswordChange({
      currentAuthKeyB64: current.authKeyB64,
      kdf,
      authKeyB64: next.authKeyB64,
      recoveryCodes: envelopes,
      entries: reencrypted,
    });
  } catch (error) {
    zeroizeAesKey(next.encryptionKey);
    rethrowInvalidCredentials(error);
  }

  replaceEncryptionKey(next.encryptionKey);
  downloadRecoveryCodes(codes);

  if (response.reEncrypted !== reencrypted.length) {
    throw new MasterPasswordError(
      `Your Master Password was changed, but the server re-encrypted ${response.reEncrypted} of ${reencrypted.length} key entries. Your new recovery codes were downloaded to this device — keep that file and check your key entries.`,
    );
  }

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
    rethrowInvalidCredentials(error);
  }

  downloadRecoveryCodes(codes);
  return codes;
}
