import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  importAesKey,
  pbkdf2Sha256,
  randomBytes,
  sha256,
  zeroize,
  zeroizeAesKey,
} from "./provider.js";
import { utf8Bytes } from "./encoding.js";

describe("crypto provider", () => {
  it("fills random bytes", () => {
    const bytes = randomBytes(16);
    assert.equal(bytes.length, 16);
    assert.equal(bytes.some((value) => value !== 0), true);
  });

  it("hashes with SHA-256", async () => {
    const digest = await sha256(utf8Bytes("keypage"));
    assert.equal(digest.length, 32);
    const again = await sha256(utf8Bytes("keypage"));
    assert.deepEqual(digest, again);
  });

  it("derives PBKDF2 bits of the requested length", async () => {
    const salt = new Uint8Array(16).fill(1);
    const bits = await pbkdf2Sha256("password", salt, 1000, 32);
    assert.equal(bits.length, 32);
  });

  it("round-trips AES-GCM with AAD", async () => {
    const raw = randomBytes(32);
    const key = await importAesKey(raw);
    const iv = randomBytes(12);
    const aad = utf8Bytes("aad");
    const plaintext = utf8Bytes("secret-payload");
    const ciphertext = await aesGcmEncrypt(key, iv, aad, plaintext);
    const decrypted = await aesGcmDecrypt(key, iv, aad, ciphertext);
    assert.deepEqual(decrypted, plaintext);
    zeroizeAesKey(key);
  });

  it("zeroizes buffers in place", () => {
    const buffer = new Uint8Array([1, 2, 3]);
    zeroize(buffer);
    assert.deepEqual(buffer, new Uint8Array([0, 0, 0]));
  });

  it("zeroizes fallback AES keys", () => {
    const bytes = new Uint8Array([9, 8, 7]);
    zeroizeAesKey({ kind: "fallback", bytes });
    assert.deepEqual(bytes, new Uint8Array([0, 0, 0]));
  });
});
