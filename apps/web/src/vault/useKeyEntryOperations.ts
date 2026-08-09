import { useMemo } from "react";

import { decryptKeyValue, encryptKeyValue, newKeyEntryId } from "@/crypto/key-entry.js";
import {
  ApiError,
  deleteKeyEntry,
  patchKeyEntry,
  postKeyEntry,
  postKeyEntryImport,
  postKeyEntryUse,
} from "@/lib/api.js";
import { copyTextWithAutoClear } from "@/lib/clipboard.js";
import { getEncryptionKeyVersion } from "@/vault/session-keys.js";
import {
  createKeyEntryOperations,
  type KeyEntryOperations,
} from "@/vault/keyEntryOperations.js";
import { useRekeyLock } from "@/vault/useRekeyLock.js";

/** Single vault-layer operations path for Key Entry writes and import. */
export function useKeyEntryOperations(): KeyEntryOperations {
  const guardRekey = useRekeyLock();
  return useMemo(
    () =>
      createKeyEntryOperations({
        guardRekey,
        getEncryptionKeyVersion,
        newKeyEntryId,
        encryptKeyValue,
        decryptKeyValue,
        postKeyEntry,
        patchKeyEntry,
        deleteKeyEntry,
        postKeyEntryUse,
        postKeyEntryImport,
        copyTextWithAutoClear,
        createSessionExpiredError: () =>
          new ApiError({
            error: "session_expired",
            message: "Vault is locked.",
          }),
      }),
    [guardRekey],
  );
}
