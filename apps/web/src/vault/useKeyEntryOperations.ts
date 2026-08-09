import { useMemo } from "react";

import {
  createKeyEntryOperations,
  type KeyEntryOperations,
} from "@/vault/keyEntryOperations.js";
import { useRekeyLock } from "@/vault/useRekeyLock.js";

/** Single vault-layer operations path for Key Entry writes and import. */
export function useKeyEntryOperations(): KeyEntryOperations {
  const guardRekey = useRekeyLock();
  return useMemo(() => createKeyEntryOperations(guardRekey), [guardRekey]);
}
