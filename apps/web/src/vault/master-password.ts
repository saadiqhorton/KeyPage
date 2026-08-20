import type {
  KeyEntry,
  SessionInfo,
  VaultPasswordChangeResponse,
} from "@keypage/shared";

import { deriveVaultKeys, keysFromMasterKey, pickKdfParams } from "@/crypto/derive.js";
import { zeroize, zeroizeAesKey, type AesKey } from "@/crypto/provider.js";
import {
  ApiError,
  getKeyEntries,
  getVaultStatus,
  postRecoveryCodesRegenerate,
  postRecoveryReset,
  postVaultLogin,
  postVaultLoginChallenge,
  postVaultLoginWithAuthKey,
  postVaultPasswordChange,
} from "@/lib/api.js";
import {
  loginClientProofB64,
  proofKeysFromSecrets,
  recoveryClientProofB64,
} from "@/crypto/auth-proof.js";

import {
  buildRekeyRecoveryEnvelopes,
  MasterPasswordError,
  rekeyEntriesAndEnvelopes,
} from "./client-rekey.js";
import { downloadRecoveryCodes } from "./recovery-download.js";
import { replaceEncryptionKey } from "./session-keys.js";

export { MasterPasswordError } from "./client-rekey.js";

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

/** One-shot enroll so /login/challenge can issue a proof (SAA-178). */
async function enrollLegacyAuthIfNeeded(
  proofReady: boolean,
  authKeyB64: string,
): Promise<void> {
  if (proofReady) {
    return;
  }
  await postVaultLogin({ authKeyB64 });
}

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
  try {
    await enrollLegacyAuthIfNeeded(status.proofReady, current.authKeyB64);
  } catch (error) {
    zeroizeAesKey(current.encryptionKey);
    rethrowInvalidCredentials(error);
  }

  onProgress?.("Loading key entries…");
  const { entries } = await getKeyEntries();

  let kdf: Awaited<ReturnType<typeof pickKdfParams>>;
  let nextProofKeys:
    | { authStoredKeyHex: string; recoveryStoredKeyHex: string }
    | undefined;
  let reencrypted;
  let codes;
  let envelopes;
  let nextEncryptionKey: AesKey | undefined;
  let nextAuthKeyB64: string | undefined;
  try {
    ({
      reencrypted,
      codes,
      envelopes,
      nextEncryptionKey,
    } = await rekeyEntriesAndEnvelopes({
      previousEncryptionKey: current.encryptionKey,
      entries,
      onProgress,
      deriveNext: async () => {
        onProgress?.("Deriving new encryption key…");
        kdf = await pickKdfParams();
        const next = await deriveVaultKeys(newPassword, kdf);
        nextAuthKeyB64 = next.authKeyB64;
        nextProofKeys = proofKeysFromSecrets({
          authKeyB64: next.authKeyB64,
          masterKey: next.masterKey,
        });
        return next;
      },
      decryptFailure: {
        empty: (first) =>
          `None of your key entries could be decrypted, so nothing was changed. First failure: “${first.label}” (${first.id}).`,
        partial: (first) =>
          `“${first.label}” (${first.id}) could not be decrypted, so nothing was changed. Check that key entry and try again.`,
        beforeEmpty: async () => {
          try {
            await postVaultLoginWithAuthKey(current.authKeyB64);
          } catch (error) {
            zeroizeAesKey(current.encryptionKey);
            if (error instanceof ApiError && error.code === "invalid_credentials") {
              throw error;
            }
            throw error;
          }
        },
      },
    }));
  } catch (error) {
    zeroizeAesKey(current.encryptionKey);
    if (nextEncryptionKey) {
      zeroizeAesKey(nextEncryptionKey);
    }
    throw error;
  }

  zeroizeAesKey(current.encryptionKey);

  onProgress?.("Saving new Master Password…");
  let response: VaultPasswordChangeResponse;
  try {
    const challenge = await postVaultLoginChallenge();
    response = await postVaultPasswordChange({
      challengeId: challenge.challengeId,
      nonceB64: challenge.nonceB64,
      currentClientProofB64: loginClientProofB64(
        current.authKeyB64,
        challenge.challengeId,
        challenge.nonceB64,
      ),
      kdf: kdf!,
      authStoredKeyHex: nextProofKeys!.authStoredKeyHex,
      recoveryStoredKeyHex: nextProofKeys!.recoveryStoredKeyHex,
      recoveryCodes: envelopes,
      entries: reencrypted,
    });
  } catch (error) {
    zeroizeAesKey(nextEncryptionKey);
    rethrowInvalidCredentials(error);
  }

  replaceEncryptionKey(nextEncryptionKey, response.keyVersion, nextAuthKeyB64);
  downloadRecoveryCodes(codes);

  if (response.reEncrypted !== reencrypted.length) {
    throw new MasterPasswordError(
      `Your Master Password was changed, but the server re-encrypted ${response.reEncrypted} of ${reencrypted.length} key entries. Your new recovery codes were downloaded to this device — keep that file and check your key entries.`,
    );
  }

  return codes;
}

/**
 * Recovery reset: decrypt Key Entries with the recovered master key, re-encrypt
 * under the new Master Password, and submit them with the recovery ticket.
 * Mirrors `changeMasterPassword` (ADR 0001 — all crypto in the browser).
 *
 * The caller owns `recoveredMasterKey` buffer lifetime (via
 * `RecoveryAttempt.succeeded` / `failed`); this function does not zeroize it.
 */
export async function completeVaultRecovery(
  recoveryTicket: string,
  challengeNonceB64: string,
  recoveredMasterKey: Uint8Array,
  entries: KeyEntry[],
  newPassword: string,
  onProgress?: PasswordChangeProgress,
): Promise<{ codes: string[]; session: SessionInfo; reEncrypted: number }> {
  onProgress?.("Checking vault status…");
  const status = await getVaultStatus();
  if (!status.kdf) {
    throw new Error("Vault is not initialized.");
  }

  onProgress?.("Unlocking key entries…");
  const previous = await keysFromMasterKey(
    recoveredMasterKey,
    status.kdf.saltB64,
  );

  let kdf: Awaited<ReturnType<typeof pickKdfParams>>;
  let nextProofKeys:
    | { authStoredKeyHex: string; recoveryStoredKeyHex: string }
    | undefined;
  let nextEncryptionKey: AesKey | undefined;
  let nextAuthKeyB64: string | undefined;

  try {
    const { reencrypted, codes, envelopes, nextEncryptionKey: rotatedKey } =
      await rekeyEntriesAndEnvelopes({
        previousEncryptionKey: previous.encryptionKey,
        entries,
        onProgress,
        deriveNext: async () => {
          onProgress?.("Deriving new encryption key…");
          kdf = await pickKdfParams();
          const next = await deriveVaultKeys(newPassword, kdf);
          nextAuthKeyB64 = next.authKeyB64;
          nextProofKeys = proofKeysFromSecrets({
            authKeyB64: next.authKeyB64,
            masterKey: next.masterKey,
          });
          return next;
        },
        decryptFailure: {
          empty: (first) =>
            `None of your key entries could be decrypted, so recovery was not completed. First failure: “${first.label}” (${first.id}).`,
          partial: (first) =>
            `“${first.label}” (${first.id}) could not be decrypted, so recovery was not completed. Check that key entry and try again.`,
        },
      });
    nextEncryptionKey = rotatedKey;

    onProgress?.("Saving new Master Password…");
    const response = await postRecoveryReset({
      recoveryTicket,
      challengeNonceB64,
      recoveryClientProofB64: recoveryClientProofB64(
        recoveredMasterKey,
        recoveryTicket,
        challengeNonceB64,
      ),
      kdf: kdf!,
      authStoredKeyHex: nextProofKeys!.authStoredKeyHex,
      recoveryStoredKeyHex: nextProofKeys!.recoveryStoredKeyHex,
      recoveryCodes: envelopes,
      entries: reencrypted,
    });

    // Download before validating so the user still has codes if the count check
    // fails. Do not install the session key until validation passes — otherwise
    // VaultProvider's catch + refreshStatus would report unlocked on error.
    downloadRecoveryCodes(codes);

    if (response.reEncrypted !== reencrypted.length) {
      zeroizeAesKey(nextEncryptionKey);
      nextEncryptionKey = undefined;
      throw new MasterPasswordError(
        `Your Master Password was reset, but the server re-encrypted ${response.reEncrypted} of ${reencrypted.length} key entries. Your new recovery codes were downloaded to this device — keep that file and check your key entries.`,
      );
    }

    replaceEncryptionKey(nextEncryptionKey, response.keyVersion, nextAuthKeyB64);
    // Ownership transferred to session-keys; don't zeroize in the catch below.
    nextEncryptionKey = undefined;

    return {
      codes,
      session: response.session,
      reEncrypted: response.reEncrypted,
    };
  } catch (error) {
    if (nextEncryptionKey) {
      zeroizeAesKey(nextEncryptionKey);
    }
    throw error;
  } finally {
    zeroizeAesKey(previous.encryptionKey);
  }
}

export async function regenerateRecoveryCodes(
  password: string,
  onProgress?: PasswordChangeProgress,
): Promise<string[]> {
  onProgress?.("Checking vault status…");
  const status = await getVaultStatus();
  if (!status.kdf) {
    throw new Error("Vault is not initialized.");
  }

  onProgress?.("Verifying Master Password…");
  const derived = await deriveVaultKeys(password, status.kdf);
  zeroizeAesKey(derived.encryptionKey);

  const { codes, envelopes } = await buildRekeyRecoveryEnvelopes(
    derived.masterKey,
    onProgress,
  );
  zeroize(derived.masterKey);
  try {
    await enrollLegacyAuthIfNeeded(status.proofReady, derived.authKeyB64);
  } catch (error) {
    rethrowInvalidCredentials(error);
  }

  onProgress?.("Saving recovery codes…");
  try {
    const challenge = await postVaultLoginChallenge();
    await postRecoveryCodesRegenerate({
      challengeId: challenge.challengeId,
      nonceB64: challenge.nonceB64,
      clientProofB64: loginClientProofB64(
        derived.authKeyB64,
        challenge.challengeId,
        challenge.nonceB64,
      ),
      // Pinned to the same status read that supplied the KDF params these
      // envelopes were built from, so a rotation in between is rejected rather
      // than persisted as codes wrapping a superseded master key.
      keyVersion: status.keyVersion,
      recoveryCodes: envelopes,
    });
  } catch (error) {
    rethrowInvalidCredentials(error);
  }

  downloadRecoveryCodes(codes);
  return codes;
}
