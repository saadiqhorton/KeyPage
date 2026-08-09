/**
 * Ordinary-write key-version policy for the unlocked vault.
 *
 * Owns require-pin, encrypt-and-stamp, and mismatch→lockLocal so crypto never
 * reaches into session storage for the version, and every write path shares one
 * fail-closed stamp + guard. Pin *storage* stays co-located with the AES key in
 * session-keys; this module is the sole write-path consumer.
 */

import type { KeyEntryCipherInput, KeyEntryCipherPayload } from "@keypage/shared";

import type { AesKey } from "@/crypto/provider.js";
import { ApiError } from "@/lib/api.js";

export type KeyVersionPinDeps = {
  getVersion: () => number | null;
  getKey: () => AesKey | null;
  encryptPayload: (
    key: AesKey,
    id: string,
    keyValue: string,
  ) => Promise<KeyEntryCipherPayload>;
  lockLocal: (reason: "rekeyed") => Promise<void>;
  createSessionExpiredError: () => ApiError;
};

export type KeyVersionPin = {
  current(): number | null;
  requireForWrite(): number;
  encryptKeyValue(id: string, keyValue: string): Promise<KeyEntryCipherInput>;
  guardWrite<T>(operation: Promise<T>): Promise<T>;
};

export function createKeyVersionPin(deps: KeyVersionPinDeps): KeyVersionPin {
  const requireForWrite = (): number => {
    const version = deps.getVersion();
    if (version === null) {
      throw deps.createSessionExpiredError();
    }
    return version;
  };

  return {
    current() {
      return deps.getVersion();
    },

    requireForWrite,

    async encryptKeyValue(id, keyValue) {
      const keyVersion = requireForWrite();
      const key = deps.getKey();
      if (key === null) {
        throw deps.createSessionExpiredError();
      }
      const payload = await deps.encryptPayload(key, id, keyValue);
      return { ...payload, keyVersion };
    },

    async guardWrite<T>(operation: Promise<T>): Promise<T> {
      try {
        return await operation;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === "key_version_mismatch"
        ) {
          await deps.lockLocal("rekeyed");
        }
        throw error;
      }
    },
  };
}
