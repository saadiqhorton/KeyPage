/**
 * In-memory key material store.
 *
 * Rules:
 * - Never write key material to localStorage, sessionStorage, IndexedDB, cookies, URLs, or React state.
 * - On webcrypto, the CryptoKey is non-extractable; dropping the reference is sufficient.
 * - On fallback, clearEncryptionKey zeroizes raw bytes before dropping the reference.
 * - masterKey and authKeyBytes are zeroized by callers immediately after use.
 * - Cross-tab: BroadcastChannel("keypage-lock") clears keys in every tab on lock.
 */

import { zeroize, type AesKey } from "@/crypto/provider.js";

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
let recoveredMasterKey: Uint8Array | null = null;

const keyClearedListeners = new Set<() => void>();

export function setEncryptionKey(key: AesKey): void {
  encryptionKey = key;
}

export function getEncryptionKey(): AesKey | null {
  return encryptionKey;
}

export function clearEncryptionKey(): void {
  if (encryptionKey?.kind === "fallback") {
    zeroize(encryptionKey.bytes);
  }
  encryptionKey = null;
  for (const listener of keyClearedListeners) {
    listener();
  }
}

export function onKeyCleared(listener: () => void): () => void {
  keyClearedListeners.add(listener);
  return () => keyClearedListeners.delete(listener);
}

export function setRecoveredMasterKey(key: Uint8Array): void {
  recoveredMasterKey = key;
}

export function takeRecoveredMasterKey(): Uint8Array | null {
  const key = recoveredMasterKey;
  recoveredMasterKey = null;
  return key;
}

export function clearRecoveredMasterKey(): void {
  if (recoveredMasterKey) {
    zeroize(recoveredMasterKey);
    recoveredMasterKey = null;
  }
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
