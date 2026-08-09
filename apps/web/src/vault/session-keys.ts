/**
 * In-memory key material store.
 *
 * Rules:
 * - Never write key material to localStorage, sessionStorage, IndexedDB, cookies, URLs, or React state.
 * - On webcrypto, the CryptoKey is non-extractable; dropping the reference is sufficient.
 * - On fallback, clearEncryptionKey zeroizes raw bytes before dropping the reference.
 * - masterKey and authKeyBytes are zeroized by callers immediately after use
 *   (recovery master key lifetime is managed by `recovery-session.ts`).
 * - Cross-tab: BroadcastChannel("keypage-lock") clears keys in every tab on lock.
 */

import { zeroize, zeroizeAesKey, type AesKey } from "@/crypto/provider.js";

const LOCK_CHANNEL = "keypage-lock";

let tabId: string | null = null;

function getTabId(): string {
  if (tabId === null) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    tabId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  return tabId;
}

let encryptionKey: AesKey | null = null;
/**
 * Vault key version the in-memory key belongs to. Stored here rather than in
 * React state so it cannot drift from the key itself: every write stamps it, and
 * the server rejects ciphertext whose declared version is no longer current.
 */
let encryptionKeyVersion: number | null = null;

const keyClearedListeners = new Set<() => void>();

export function setEncryptionKey(key: AesKey, keyVersion: number): void {
  encryptionKey = key;
  encryptionKeyVersion = keyVersion;
}

export function replaceEncryptionKey(key: AesKey, keyVersion: number): void {
  if (encryptionKey) {
    zeroizeAesKey(encryptionKey);
  }
  encryptionKey = key;
  encryptionKeyVersion = keyVersion;
}

export function getEncryptionKey(): AesKey | null {
  return encryptionKey;
}

export function getEncryptionKeyVersion(): number | null {
  return encryptionKeyVersion;
}

export function clearEncryptionKey(): void {
  if (encryptionKey?.kind === "fallback") {
    zeroize(encryptionKey.bytes);
  }
  encryptionKey = null;
  encryptionKeyVersion = null;
  for (const listener of keyClearedListeners) {
    listener();
  }
}

export function onKeyCleared(listener: () => void): () => void {
  keyClearedListeners.add(listener);
  return () => keyClearedListeners.delete(listener);
}

export function broadcastLock(reason?: string): void {
  try {
    const channel = new BroadcastChannel(LOCK_CHANNEL);
    channel.postMessage({ type: "lock", reason, tabId: getTabId() });
    channel.close();
  } catch {
    // BroadcastChannel unavailable — single-tab lock still works.
  }
}

export function subscribeLockBroadcast(onLock: (reason: string) => void): () => void {
  try {
    const channel = new BroadcastChannel(LOCK_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.type !== "lock") return;
      if (event.data.tabId === getTabId()) return;
      clearEncryptionKey();
      onLock(event.data.reason ?? "manual");
    };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
