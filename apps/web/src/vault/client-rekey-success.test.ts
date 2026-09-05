import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyEntry, KdfParams } from "@keypage/shared";

import { base64Encode } from "@/crypto/encoding.js";
import { deriveVaultKeys } from "@/crypto/derive.js";
import { encryptKeyValueWith } from "@/crypto/key-entry.js";
import { zeroizeAesKey } from "@/crypto/provider.js";

import {
  decryptAllKeyEntries,
  encryptAllKeyEntries,
  MasterPasswordError,
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
  return makeEntry({
    id,
    label,
    cipher: { ...cipher, keyVersion: 1 },
  });
}

describe("decryptAllKeyEntries success path", () => {
  it("decrypts every entry and reports progress", async () => {
    const derived = await deriveVaultKeys("vault-password", FAST_KDF);
    const entry = await encryptedEntry(
      "vault-password",
      "550e8400-e29b-41d4-a716-446655440000",
      "Prod",
      "secret-value",
    );
    const progress: string[] = [];

    const result = await decryptAllKeyEntries(derived.encryptionKey, [entry], {
      onProgress: (label) => progress.push(label),
      emptyFailureMessage: () => "empty",
      partialFailureMessage: () => "partial",
    });

    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, entry.id);
    assert.equal(result[0]!.plaintext, "secret-value");
    assert.equal(result[0]!.baseIvB64, entry.cipher.ivB64);
    assert.deepEqual(progress, ["Decrypting key entries…"]);
    zeroizeAesKey(derived.encryptionKey);
  });
});

describe("encryptAllKeyEntries empty set", () => {
  it("returns an empty array without reporting progress", async () => {
    const derived = await deriveVaultKeys("vault-password", FAST_KDF);
    const progress: string[] = [];
    const result = await encryptAllKeyEntries(derived.encryptionKey, [], (label) =>
      progress.push(label),
    );
    assert.deepEqual(result, []);
    assert.deepEqual(progress, []);
    zeroizeAesKey(derived.encryptionKey);
  });
});

describe("MasterPasswordError", () => {
  it("sets the error name", () => {
    const error = new MasterPasswordError("nope");
    assert.equal(error.name, "MasterPasswordError");
    assert.equal(error.message, "nope");
  });
});
