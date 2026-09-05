import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KdfParams } from "@keypage/shared";

import { decryptKeyValue, decryptKeyValueWith, encryptKeyValueWith, keyEntryAad, newKeyEntryId } from "./key-entry.js";
import { deriveVaultKeys } from "./derive.js";
import { base64Encode, utf8Bytes } from "./encoding.js";
import { zeroizeAesKey } from "./provider.js";
import { clearEncryptionKey, setEncryptionKey } from "@/vault/session-keys.js";

const FAST_KDF: KdfParams = {
  algorithm: "pbkdf2-sha256",
  saltB64: base64Encode(new Uint8Array(16).fill(4)),
  iterations: 1000,
};

describe("key-entry crypto", () => {
  it("mints a UUID v4 id", () => {
    const id = newKeyEntryId();
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("binds AAD to the entry id", () => {
    const aad = keyEntryAad("entry-1");
    assert.deepEqual(aad, utf8Bytes("keypage:v1:key-entry:entry-1"));
  });

  it("round-trips a secret with a derived vault key", async () => {
    const derived = await deriveVaultKeys("vault-password", FAST_KDF);
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const cipher = await encryptKeyValueWith(
      derived.encryptionKey,
      id,
      "sk-live-secret",
    );
    const plaintext = await decryptKeyValueWith(derived.encryptionKey, {
      id,
      cipher: { ...cipher, keyVersion: 1 },
    });
    assert.equal(plaintext, "sk-live-secret");
    assert.equal(cipher.algorithm, "aes-256-gcm");
    zeroizeAesKey(derived.encryptionKey);
  });

  it("decryptKeyValue fails closed while the vault is locked", async () => {
    clearEncryptionKey();
    await assert.rejects(
      () =>
        decryptKeyValue({
          id: "550e8400-e29b-41d4-a716-446655440000",
          label: "x",
          serviceId: "openai",
          customServiceName: null,
          description: null,
          tags: [],
          cipher: {
            algorithm: "aes-256-gcm",
            ivB64: base64Encode(new Uint8Array(12)),
            ciphertextB64: base64Encode(new Uint8Array(16)),
            keyVersion: 1,
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: null,
        }),
      /Vault is locked/,
    );
  });

  it("decryptKeyValue uses the session encryption key", async () => {
    const derived = await deriveVaultKeys("vault-password", FAST_KDF);
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const cipher = await encryptKeyValueWith(
      derived.encryptionKey,
      id,
      "session-secret",
    );
    setEncryptionKey(derived.encryptionKey, 1, derived.authKeyB64);
    const plaintext = await decryptKeyValue({
      id,
      label: "x",
      serviceId: "openai",
      customServiceName: null,
      description: null,
      tags: [],
      cipher: { ...cipher, keyVersion: 1 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
    });
    assert.equal(plaintext, "session-secret");
    clearEncryptionKey();
  });
});
