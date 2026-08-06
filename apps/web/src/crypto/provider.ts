import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";

import { utf8Bytes } from "./encoding.js";

export type CryptoBackend = "webcrypto" | "fallback";

function asBufferSource(data: Uint8Array): BufferSource {
  return data as BufferSource;
}

function detectBackend(): CryptoBackend {
  return globalThis.crypto?.subtle ? "webcrypto" : "fallback";
}

export const cryptoBackend: CryptoBackend = detectBackend();

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  if (cryptoBackend === "webcrypto") {
    const digest = await crypto.subtle.digest("SHA-256", asBufferSource(data));
    return new Uint8Array(digest);
  }
  return nobleSha256(data);
}

export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  lengthBytes: number,
): Promise<Uint8Array> {
  if (cryptoBackend === "webcrypto") {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      asBufferSource(ikm),
      "HKDF",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: asBufferSource(salt),
        info: asBufferSource(utf8Bytes(info)),
      },
      keyMaterial,
      lengthBytes * 8,
    );
    return new Uint8Array(bits);
  }
  return hkdf(nobleSha256, ikm, salt, utf8Bytes(info), lengthBytes);
}

export async function pbkdf2Sha256(
  password: string,
  salt: Uint8Array,
  iterations: number,
  lengthBytes: number,
): Promise<Uint8Array> {
  if (cryptoBackend === "webcrypto") {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      asBufferSource(utf8Bytes(password)),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: asBufferSource(salt),
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      lengthBytes * 8,
    );
    return new Uint8Array(bits);
  }
  return pbkdf2Async(nobleSha256, password, salt, {
    c: iterations,
    dkLen: lengthBytes,
  });
}

/**
 * Opaque AES-256-GCM key. On the webcrypto backend this is a non-extractable
 * CryptoKey. On the fallback backend it holds raw key bytes in memory — the
 * trade-off for plain-HTTP LAN access where crypto.subtle is unavailable.
 */
export type AesKey =
  | { kind: "webcrypto"; key: CryptoKey }
  | { kind: "fallback"; bytes: Uint8Array };

export async function importAesKey(raw: Uint8Array): Promise<AesKey> {
  if (cryptoBackend === "webcrypto") {
    const key = await crypto.subtle.importKey(
      "raw",
      asBufferSource(raw),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return { kind: "webcrypto", key };
  }
  return { kind: "fallback", bytes: new Uint8Array(raw) };
}

export async function aesGcmEncrypt(
  key: AesKey,
  iv: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  if (key.kind === "webcrypto") {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(aad),
      },
      key.key,
      asBufferSource(plaintext),
    );
    return new Uint8Array(ciphertext);
  }
  const cipher = gcm(key.bytes, iv, aad);
  return cipher.encrypt(plaintext);
}

export async function aesGcmDecrypt(
  key: AesKey,
  iv: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  if (key.kind === "webcrypto") {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(aad),
      },
      key.key,
      asBufferSource(ciphertext),
    );
    return new Uint8Array(plaintext);
  }
  const cipher = gcm(key.bytes, iv, aad);
  return cipher.decrypt(ciphertext);
}

export function zeroize(...buffers: Uint8Array[]): void {
  for (const buffer of buffers) {
    buffer.fill(0);
  }
}

export function zeroizeAesKey(key: AesKey): void {
  if (key.kind === "fallback") {
    zeroize(key.bytes);
  }
}
