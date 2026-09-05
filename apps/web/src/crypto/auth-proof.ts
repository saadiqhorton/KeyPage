import {
  createLoginClientProof,
  createRecoveryClientProof,
  loginAuthMessage,
  loginStoredKeyHexFromAuthKey,
  recoveryAuthMessage,
  recoveryStoredKeyHexFromMasterKey,
  base64Encode,
} from "@keypage/shared";

import { base64Decode as webB64Decode } from "./encoding.js";

/** Re-export decode used when verifying local vectors in tests. */
export { base64Decode } from "@keypage/shared";

export function authKeyBytesFromB64(authKeyB64: string): Uint8Array {
  return webB64Decode(authKeyB64);
}

export function proofKeysFromSecrets(args: {
  authKeyB64: string;
  masterKey: Uint8Array;
}): { authStoredKeyHex: string; recoveryStoredKeyHex: string } {
  const authKey = authKeyBytesFromB64(args.authKeyB64);
  try {
    return {
      authStoredKeyHex: loginStoredKeyHexFromAuthKey(authKey),
      recoveryStoredKeyHex: recoveryStoredKeyHexFromMasterKey(args.masterKey),
    };
  } finally {
    authKey.fill(0);
  }
}

export function loginClientProofB64(
  authKeyB64: string,
  challengeId: string,
  nonceB64: string,
): string {
  const authKey = authKeyBytesFromB64(authKeyB64);
  try {
    const proof = createLoginClientProof(
      authKey,
      loginAuthMessage(challengeId, nonceB64),
    );
    return base64Encode(proof);
  } finally {
    authKey.fill(0);
  }
}

export function recoveryClientProofB64(
  masterKey: Uint8Array,
  recoveryTicket: string,
  challengeNonceB64: string,
): string {
  const proof = createRecoveryClientProof(
    masterKey,
    recoveryAuthMessage(recoveryTicket, challengeNonceB64),
  );
  return base64Encode(proof);
}
