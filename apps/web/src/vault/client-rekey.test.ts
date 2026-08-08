import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyEntry, KdfParams } from "@keypage/shared";

import { base64Encode } from "@/crypto/encoding.js";
import { deriveVaultKeys } from "@/crypto/derive.js";
import { encryptKeyValueWith } from "@/crypto/key-entry.js";
import { zeroize, zeroizeAesKey } from "@/crypto/provider.js";

import {
  decryptAllKeyEntries,
  encryptAllKeyEntries,
  MasterPasswordError,
  rekeyEntriesAndEnvelopes,
} from "./client-rekey.js";

const FAST_KDF: KdfParams = {
  algorithm: "pbkdf2-sha256",
  saltB64: base64Encode(new Uint8Array(16).fill(9)),
  iterations: 1000,
};

function makeEntry(
  overrides: Partial<KeyEntry> & Pick<KeyEntry, "id" | "cipher">,
): KeyEntry {
  return {
    label: "Production",
    serviceId: "openai",
    customServiceName: null,
    description: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

async function encryptedEntry(
  password: string,
  id: string,
  label: string,
  secret: string,
): Promise<KeyEntry> {
  const derived = await deriveVaultKeys(password, FAST_KDF);
  const cipher = await encryptKeyValueWith(derived.encryptionKey, id, secret);
  zeroizeAesKey(derived.encryptionKey);
  zeroize(derived.masterKey);
  return makeEntry({
    id,
    label,
    cipher: { ...cipher, keyVersion: 1 },
  });
}

describe("decryptAllKeyEntries", () => {
  it("returns an empty array when there are no entries", async () => {
    const derived = await deriveVaultKeys("vault-password", FAST_KDF);
    const result = await decryptAllKeyEntries(derived.encryptionKey, [], {
      emptyFailureMessage: () => "empty",
      partialFailureMessage: () => "partial",
    });
    zeroizeAesKey(derived.encryptionKey);
    assert.deepEqual(result, []);
  });

  it("fails closed when every entry fails to decrypt", async () => {
    const good = await deriveVaultKeys("vault-password", FAST_KDF);
    const bad = await deriveVaultKeys("other-password", FAST_KDF);
    const entry = await encryptedEntry(
      "vault-password",
      "550e8400-e29b-41d4-a716-446655440000",
      "Broken",
      "secret",
    );

    await assert.rejects(
      () =>
        decryptAllKeyEntries(bad.encryptionKey, [entry], {
          emptyFailureMessage: (first) => `empty:${first.label}:${first.id}`,
          partialFailureMessage: () => "partial",
        }),
      (error: unknown) => {
        assert.ok(error instanceof MasterPasswordError);
        assert.equal(
          error.message,
          "empty:Broken:550e8400-e29b-41d4-a716-446655440000",
        );
        return true;
      },
    );

    zeroizeAesKey(good.encryptionKey);
    zeroizeAesKey(bad.encryptionKey);
  });

  it("fails closed on partial decrypt failure", async () => {
    const derived = await deriveVaultKeys("vault-password", FAST_KDF);
    const good = await encryptedEntry(
      "vault-password",
      "550e8400-e29b-41d4-a716-446655440000",
      "Good",
      "secret-a",
    );
    const bad = makeEntry({
      id: "660e8400-e29b-41d4-a716-446655440001",
      label: "Bad",
      cipher: good.cipher,
    });

    await assert.rejects(
      () =>
        decryptAllKeyEntries(derived.encryptionKey, [good, bad], {
          emptyFailureMessage: () => "empty",
          partialFailureMessage: (first) => `partial:${first.label}:${first.id}`,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MasterPasswordError);
        assert.equal(
          error.message,
          "partial:Bad:660e8400-e29b-41d4-a716-446655440001",
        );
        return true;
      },
    );

    zeroizeAesKey(derived.encryptionKey);
  });

  it("calls beforeEmptyFailure before throwing on total decrypt failure", async () => {
    const derived = await deriveVaultKeys("vault-password", FAST_KDF);
    const entry = await encryptedEntry(
      "other-password",
      "550e8400-e29b-41d4-a716-446655440000",
      "Broken",
      "secret",
    );
    let called = false;

    await assert.rejects(
      () =>
        decryptAllKeyEntries(derived.encryptionKey, [entry], {
          emptyFailureMessage: () => "empty",
          partialFailureMessage: () => "partial",
          beforeEmptyFailure: async () => {
            called = true;
          },
        }),
      MasterPasswordError,
    );

    assert.equal(called, true);
    zeroizeAesKey(derived.encryptionKey);
  });
});

describe("encryptAllKeyEntries", () => {
  it("preserves ids and base IVs while re-encrypting", async () => {
    const previous = await deriveVaultKeys("old-password", FAST_KDF);
    const next = await deriveVaultKeys("new-password", FAST_KDF);
    const entry = await encryptedEntry(
      "old-password",
      "550e8400-e29b-41d4-a716-446655440000",
      "Prod",
      "secret-value",
    );

    const decrypted = await decryptAllKeyEntries(
      previous.encryptionKey,
      [entry],
      {
        emptyFailureMessage: () => "empty",
        partialFailureMessage: () => "partial",
      },
    );

    const reencrypted = await encryptAllKeyEntries(
      next.encryptionKey,
      decrypted,
    );

    assert.equal(reencrypted.length, 1);
    assert.equal(reencrypted[0]!.id, entry.id);
    assert.equal(reencrypted[0]!.baseIvB64, entry.cipher.ivB64);
    assert.equal(reencrypted[0]!.cipher.algorithm, "aes-256-gcm");
    assert.notEqual(
      reencrypted[0]!.cipher.ciphertextB64,
      entry.cipher.ciphertextB64,
    );

    zeroizeAesKey(previous.encryptionKey);
    zeroizeAesKey(next.encryptionKey);
    zeroize(next.masterKey);
  });
});

describe("rekeyEntriesAndEnvelopes", () => {
  it("runs decrypt, encrypt, and envelope stages in order", async () => {
    const previous = await deriveVaultKeys("old-password", FAST_KDF);
    const next = await deriveVaultKeys("new-password", FAST_KDF);
    const entry = await encryptedEntry(
      "old-password",
      "550e8400-e29b-41d4-a716-446655440000",
      "Prod",
      "secret-value",
    );
    const progress: string[] = [];

    const result = await rekeyEntriesAndEnvelopes({
      previousEncryptionKey: previous.encryptionKey,
      entries: [entry],
      onProgress: (label) => progress.push(label),
      deriveNext: async () => next,
      decryptFailure: {
        empty: () => "empty",
        partial: () => "partial",
      },
    });

    assert.equal(result.reencrypted.length, 1);
    assert.equal(result.codes.length > 0, true);
    assert.equal(result.envelopes.length, result.codes.length);
    assert.deepEqual(progress, [
      "Decrypting key entries…",
      "Re-encrypting key entries…",
      "Generating recovery codes…",
    ]);

    zeroizeAesKey(previous.encryptionKey);
    zeroizeAesKey(result.nextEncryptionKey);
  });
});
