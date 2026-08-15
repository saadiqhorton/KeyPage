/**
 * SCRAM-style possession proofs so authKey / masterKey never cross the wire.
 *
 * clientKey = HMAC-SHA256(secret, label)
 * storedKey = SHA-256(clientKey)          // server stores this
 * clientProof = clientKey XOR HMAC-SHA256(storedKey, authMessage)
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const LOGIN_CLIENT_KEY_LABEL = "keypage:v1:login-client-key";
export const RECOVERY_CLIENT_KEY_LABEL = "keypage:v1:recovery-client-key";
export const LOGIN_CHALLENGE_TTL_SECONDS = 60;
/** Cap on unexpired login_challenges rows (SAA-177). */
export const LOGIN_CHALLENGE_MAX_OPEN = 20;
export const STORED_KEY_HEX_BYTES = 32;

const textEncoder = new TextEncoder();

function utf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new Error("XOR length mismatch");
  }
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i]! ^ b[i]!;
  }
  return out;
}

export function hexEncode(data: Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function hexDecode(text: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(text) || text.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function base64Encode(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(data).toString("base64");
  }
  let bin = "";
  for (const byte of data) {
    bin += String.fromCharCode(byte);
  }
  return btoa(bin);
}

export function base64Decode(text: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(text, "base64"));
  }
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function isStoredKeyHex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function storedKeyFromSecret(
  secret: Uint8Array,
  label: string,
): Uint8Array {
  const clientKey = hmac(sha256, secret, utf8(label));
  const storedKey = sha256(clientKey);
  clientKey.fill(0);
  return storedKey;
}

export function storedKeyHexFromSecret(
  secret: Uint8Array,
  label: string,
): string {
  const storedKey = storedKeyFromSecret(secret, label);
  const hex = hexEncode(storedKey);
  storedKey.fill(0);
  return hex;
}

export function loginStoredKeyHexFromAuthKey(authKey: Uint8Array): string {
  return storedKeyHexFromSecret(authKey, LOGIN_CLIENT_KEY_LABEL);
}

export function recoveryStoredKeyHexFromMasterKey(
  masterKey: Uint8Array,
): string {
  return storedKeyHexFromSecret(masterKey, RECOVERY_CLIENT_KEY_LABEL);
}

export function createClientProof(
  secret: Uint8Array,
  label: string,
  authMessage: string,
): Uint8Array {
  const clientKey = hmac(sha256, secret, utf8(label));
  const storedKey = sha256(clientKey);
  const clientSignature = hmac(sha256, storedKey, utf8(authMessage));
  const proof = xorBytes(clientKey, clientSignature);
  clientKey.fill(0);
  storedKey.fill(0);
  clientSignature.fill(0);
  return proof;
}

export function createLoginClientProof(
  authKey: Uint8Array,
  authMessage: string,
): Uint8Array {
  return createClientProof(authKey, LOGIN_CLIENT_KEY_LABEL, authMessage);
}

export function createRecoveryClientProof(
  masterKey: Uint8Array,
  authMessage: string,
): Uint8Array {
  return createClientProof(
    masterKey,
    RECOVERY_CLIENT_KEY_LABEL,
    authMessage,
  );
}

export function verifyClientProof(
  storedKeyHex: string,
  authMessage: string,
  clientProof: Uint8Array,
): boolean {
  if (!isStoredKeyHex(storedKeyHex) || clientProof.length !== 32) {
    return false;
  }
  const storedKey = hexDecode(storedKeyHex);
  const clientSignature = hmac(sha256, storedKey, utf8(authMessage));
  const clientKey = xorBytes(clientProof, clientSignature);
  const expectedStored = sha256(clientKey);
  const ok = bytesEqual(expectedStored, storedKey);
  clientSignature.fill(0);
  clientKey.fill(0);
  expectedStored.fill(0);
  storedKey.fill(0);
  return ok;
}

/** Login challenge auth message: challengeId + nonce (both server-issued). */
export function loginAuthMessage(challengeId: string, nonceB64: string): string {
  return `login:${challengeId}:${nonceB64}`;
}

/** Recovery reset auth message binds ticket + claim challenge nonce. */
export function recoveryAuthMessage(
  recoveryTicket: string,
  challengeNonceB64: string,
): string {
  return `recovery:${recoveryTicket}:${challengeNonceB64}`;
}
