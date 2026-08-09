import { useMemo } from "react";

import {
  decryptKeyValue,
  encryptKeyValueWith,
  newKeyEntryId,
} from "@/crypto/key-entry.js";
import {
  ApiError,
  deleteKeyEntry,
  patchKeyEntry,
  postKeyEntry,
  postKeyEntryImport,
  postKeyEntryUse,
} from "@/lib/api.js";
import { copyTextWithAutoClear } from "@/lib/clipboard.js";
import {
  createKeyEntryOperations,
  type KeyEntryOperations,
} from "@/vault/keyEntryOperations.js";
import { createKeyVersionPin } from "@/vault/key-version-pin.js";
import {
  getEncryptionKey,
  getEncryptionKeyVersion,
} from "@/vault/session-keys.js";
import { useVault } from "@/vault/useVault.js";

/** Single vault-layer operations path for Key Entry writes and import. */
export function useKeyEntryOperations(): KeyEntryOperations {
  const { actions } = useVault();
  const pin = useMemo(
    () =>
      createKeyVersionPin({
        getVersion: getEncryptionKeyVersion,
        getKey: getEncryptionKey,
        encryptPayload: encryptKeyValueWith,
        lockLocal: (reason) => actions.lockLocal(reason),
        createSessionExpiredError: () =>
          new ApiError({
            error: "session_expired",
            message: "Vault is locked.",
          }),
      }),
    [actions],
  );
  return useMemo(
    () =>
      createKeyEntryOperations({
        pin,
        newKeyEntryId,
        decryptKeyValue,
        postKeyEntry,
        patchKeyEntry,
        deleteKeyEntry,
        postKeyEntryUse,
        postKeyEntryImport,
        copyTextWithAutoClear,
      }),
    [pin],
  );
}
