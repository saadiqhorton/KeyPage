import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DERIVED_KEY_BYTES, KDF_SALT_BYTES, type KdfParams } from "@keypage/shared";

import { deriveVaultKeys, keysFromMasterKey, pickKdfParams } from "./derive.js";
import { base64Encode } from "./encoding.js";
import { zeroize, zeroizeAesKey } from "./provider.js";

const FAST_KDF: KdfParams = {
  algorithm: "pbkdf2-sha256",
  saltB64: base64Encode(new Uint8Array(KDF_SALT_BYTES).fill(3)),
  iterations: 1000,
};

const FAST_ARGON2: KdfParams = {
  algorithm: "argon2id",
  saltB64: base64Encode(new Uint8Array(KDF_SALT_BYTES).fill(5)),
  iterations: 1,
  memoryKiB: 1024,
  parallelism: 1,
};

describe("keysFromMasterKey", () => {
  it("rejects a salt of the wrong length", async () => {
    const masterKey = new Uint8Array(DERIVED_KEY_BYTES).fill(9);
    await assert.rejects(
      () => keysFromMasterKey(masterKey, base64Encode(new Uint8Array(8))),
      /KDF salt must be 16 bytes/,
    );
  });

  it("derives distinct encryption and auth keys from the same master key", async () => {
    const masterKey = new Uint8Array(DERIVED_KEY_BYTES).fill(11);
    const first = await keysFromMasterKey(masterKey, FAST_KDF.saltB64);
    const second = await keysFromMasterKey(masterKey, FAST_KDF.saltB64);
    assert.equal(first.authKeyB64, second.authKeyB64);
    assert.equal(typeof first.authKeyB64, "string");
    assert.ok(first.encryptionKey.kind === "webcrypto" || first.encryptionKey.kind === "fallback");
    zeroizeAesKey(first.encryptionKey);
    zeroizeAesKey(second.encryptionKey);
  });
});

describe("deriveVaultKeys", () => {
  it("rejects a salt of the wrong length", async () => {
    await assert.rejects(
      () =>
        deriveVaultKeys("password", {
          ...FAST_KDF,
          saltB64: base64Encode(new Uint8Array(8)),
        }),
      /KDF salt must be 16 bytes/,
    );
  });

  it("round-trips PBKDF2 keys for the same password and salt", async () => {
    const a = await deriveVaultKeys("correct-horse", FAST_KDF);
    const b = await deriveVaultKeys("correct-horse", FAST_KDF);
    const other = await deriveVaultKeys("other-password", FAST_KDF);
    assert.equal(a.authKeyB64, b.authKeyB64);
    assert.notEqual(a.authKeyB64, other.authKeyB64);
    assert.equal(a.masterKey.length, DERIVED_KEY_BYTES);
    zeroize(a.masterKey, b.masterKey, other.masterKey);
    zeroizeAesKey(a.encryptionKey);
    zeroizeAesKey(b.encryptionKey);
    zeroizeAesKey(other.encryptionKey);
  });

  it("derives keys with argon2id", async () => {
    const derived = await deriveVaultKeys("argon-password", FAST_ARGON2);
    assert.equal(derived.masterKey.length, DERIVED_KEY_BYTES);
    assert.equal(typeof derived.authKeyB64, "string");
    zeroize(derived.masterKey);
    zeroizeAesKey(derived.encryptionKey);
  });
});

describe("pickKdfParams", () => {
  it("returns a salt of the required length and a supported algorithm", async () => {
    const kdf = await pickKdfParams();
    assert.ok(kdf.algorithm === "argon2id" || kdf.algorithm === "pbkdf2-sha256");
    assert.equal(Buffer.from(kdf.saltB64, "base64").length, KDF_SALT_BYTES);
    assert.ok(kdf.iterations > 0);
    if (kdf.algorithm === "argon2id") {
      assert.ok((kdf.memoryKiB ?? 0) > 0);
      assert.ok((kdf.parallelism ?? 0) > 0);
    }
  });
});
