import type {
  KeyEntry,
  ReencryptedKeyEntry,
  RecoveryCodeEnvelope,
} from "@keypage/shared";

import {
  decryptKeyValueWith,
  encryptKeyValueWith,
} from "@/crypto/key-entry.js";
import { buildRecoveryCodeEnvelopes } from "@/crypto/recovery.js";
import { zeroize, zeroizeAesKey, type AesKey } from "@/crypto/provider.js";

export class MasterPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterPasswordError";
  }
}

export type RekeyProgress = (label: string) => void;

export type DecryptedEntry = {
  id: string;
  plaintext: string;
  baseIvB64: string;
};

export type DecryptAllOptions = {
  onProgress?: RekeyProgress;
  emptyFailureMessage: (first: { label: string; id: string }) => string;
  partialFailureMessage: (first: { label: string; id: string }) => string;
  /** Called after all decrypts fail, before throwing the empty failure. */
  beforeEmptyFailure?: (first: { label: string; id: string }) => Promise<void>;
};

/** Decrypt every entry; fail closed on any decrypt failure (same messages as today). */
export async function decryptAllKeyEntries(
  encryptionKey: AesKey,
  entries: KeyEntry[],
  options: DecryptAllOptions,
): Promise<DecryptedEntry[]> {
  if (entries.length === 0) {
    return [];
  }

  options.onProgress?.("Decrypting key entries…");

  const decrypted: DecryptedEntry[] = [];
  let firstFailedEntry: { label: string; id: string } | undefined;

  for (const entry of entries) {
    try {
      const plaintext = await decryptKeyValueWith(encryptionKey, entry);
      decrypted.push({
        id: entry.id,
        plaintext,
        baseIvB64: entry.cipher.ivB64,
      });
    } catch {
      if (!firstFailedEntry) {
        firstFailedEntry = { label: entry.label, id: entry.id };
      }
    }
  }

  if (decrypted.length === 0) {
    if (firstFailedEntry && options.beforeEmptyFailure) {
      await options.beforeEmptyFailure(firstFailedEntry);
    }
    throw new MasterPasswordError(
      options.emptyFailureMessage(firstFailedEntry!),
    );
  }

  if (firstFailedEntry) {
    throw new MasterPasswordError(
      options.partialFailureMessage(firstFailedEntry),
    );
  }

  return decrypted;
}

/** Encrypt decrypted entries under the next encryption key. */
export async function encryptAllKeyEntries(
  encryptionKey: AesKey,
  decrypted: DecryptedEntry[],
  onProgress?: RekeyProgress,
): Promise<ReencryptedKeyEntry[]> {
  if (decrypted.length > 0) {
    onProgress?.("Re-encrypting key entries…");
  }

  const reencrypted: ReencryptedKeyEntry[] = [];
  for (const item of decrypted) {
    const cipher = await encryptKeyValueWith(
      encryptionKey,
      item.id,
      item.plaintext,
    );
    reencrypted.push({ id: item.id, baseIvB64: item.baseIvB64, cipher });
  }

  return reencrypted;
}

/** Envelopes stage alone — regen driver. Same module owns envelope construction. */
export async function buildRekeyRecoveryEnvelopes(
  masterKey: Uint8Array,
  onProgress?: RekeyProgress,
): Promise<{ codes: string[]; envelopes: RecoveryCodeEnvelope[] }> {
  onProgress?.("Generating recovery codes…");
  return buildRecoveryCodeEnvelopes(masterKey);
}

/**
 * The deep pipeline body shared by password-change and recovery:
 * decrypt-all → derive/next (driver callback) → encrypt-all → envelopes.
 */
export async function rekeyEntriesAndEnvelopes(args: {
  previousEncryptionKey: AesKey;
  entries: KeyEntry[];
  deriveNext: () => Promise<{ encryptionKey: AesKey; masterKey: Uint8Array }>;
  onProgress?: RekeyProgress;
  decryptFailure: {
    empty: (first: { label: string; id: string }) => string;
    partial: (first: { label: string; id: string }) => string;
    beforeEmpty?: (first: { label: string; id: string }) => Promise<void>;
  };
}): Promise<{
  reencrypted: ReencryptedKeyEntry[];
  codes: string[];
  envelopes: RecoveryCodeEnvelope[];
  nextEncryptionKey: AesKey;
}> {
  const decrypted = await decryptAllKeyEntries(
    args.previousEncryptionKey,
    args.entries,
    {
      onProgress: args.onProgress,
      emptyFailureMessage: args.decryptFailure.empty,
      partialFailureMessage: args.decryptFailure.partial,
      beforeEmptyFailure: args.decryptFailure.beforeEmpty,
    },
  );

  const next = await args.deriveNext();

  try {
    const reencrypted = await encryptAllKeyEntries(
      next.encryptionKey,
      decrypted,
      args.onProgress,
    );

    const { codes, envelopes } = await buildRekeyRecoveryEnvelopes(
      next.masterKey,
      args.onProgress,
    );
    zeroize(next.masterKey);

    return {
      reencrypted,
      codes,
      envelopes,
      nextEncryptionKey: next.encryptionKey,
    };
  } catch (error) {
    zeroizeAesKey(next.encryptionKey);
    zeroize(next.masterKey);
    throw error;
  }
}
