import { useCallback } from "react";

import { ApiError } from "@/lib/api.js";

import { useVault } from "./useVault.js";

export type RekeyGuard = <T>(operation: Promise<T>) => Promise<T>;

/**
 * Wraps a write that carries ciphertext.
 *
 * A rejected key version means the vault was re-keyed while this tab still held
 * the previous encryption key, so nothing this tab encrypts from here on could
 * ever be read back. Dropping the key and returning to the unlock screen is the
 * only recoverable outcome; the error still propagates so callers can report it.
 */
export function useRekeyLock(): RekeyGuard {
  const { actions } = useVault();

  return useCallback(
    async <T>(operation: Promise<T>): Promise<T> => {
      try {
        return await operation;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.code === "key_version_mismatch"
        ) {
          await actions.lockLocal("rekeyed");
        }
        throw error;
      }
    },
    [actions],
  );
}
