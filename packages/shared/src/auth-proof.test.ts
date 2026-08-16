import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOGIN_CLIENT_KEY_LABEL,
  RECOVERY_CLIENT_KEY_LABEL,
  base64Encode,
  createClientProof,
  createLoginClientProof,
  createRecoveryClientProof,
  loginAuthMessage,
  loginStoredKeyHexFromAuthKey,
  recoveryAuthMessage,
  recoveryStoredKeyHexFromMasterKey,
  verifyClientProof,
} from "./auth-proof.js";

describe("auth-proof", () => {
  it("round-trips a login proof", () => {
    const authKey = new Uint8Array(32).fill(7);
    const storedHex = loginStoredKeyHexFromAuthKey(authKey);
    const message = loginAuthMessage("chal-1", "bm9uY2U=");
    const proof = createLoginClientProof(authKey, message);

    assert.equal(verifyClientProof(storedHex, message, proof), true);
    assert.equal(
      verifyClientProof(storedHex, loginAuthMessage("chal-1", "other"), proof),
      false,
    );
  });

  it("round-trips a recovery proof", () => {
    const masterKey = new Uint8Array(32).fill(9);
    const storedHex = recoveryStoredKeyHexFromMasterKey(masterKey);
    const message = recoveryAuthMessage("ticket-token", "Y2hhbA==");
    const proof = createRecoveryClientProof(masterKey, message);

    assert.equal(verifyClientProof(storedHex, message, proof), true);
  });

  it("rejects a proof for a different secret", () => {
    const authKey = new Uint8Array(32).fill(1);
    const other = new Uint8Array(32).fill(2);
    const storedHex = loginStoredKeyHexFromAuthKey(authKey);
    const message = loginAuthMessage("c", "bg==");
    const proof = createClientProof(other, LOGIN_CLIENT_KEY_LABEL, message);

    assert.equal(verifyClientProof(storedHex, message, proof), false);
  });

  it("uses distinct labels for login vs recovery", () => {
    const secret = new Uint8Array(32).fill(3);
    const loginHex = loginStoredKeyHexFromAuthKey(secret);
    const recoveryHex = recoveryStoredKeyHexFromMasterKey(secret);
    assert.notEqual(loginHex, recoveryHex);

    const message = "msg";
    const loginProof = createClientProof(secret, LOGIN_CLIENT_KEY_LABEL, message);
    const recoveryProof = createClientProof(
      secret,
      RECOVERY_CLIENT_KEY_LABEL,
      message,
    );
    assert.notEqual(base64Encode(loginProof), base64Encode(recoveryProof));
  });
});
