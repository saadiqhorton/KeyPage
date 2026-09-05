import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLoginClientProof,
  loginAuthMessage,
  loginStoredKeyHexFromAuthKey,
  recoveryStoredKeyHexFromMasterKey,
  verifyClientProof,
} from "@keypage/shared";

import {
  authKeyBytesFromB64,
  loginClientProofB64,
  proofKeysFromSecrets,
  recoveryClientProofB64,
  base64Decode,
} from "./auth-proof.js";
import { base64Encode } from "./encoding.js";

describe("auth-proof helpers", () => {
  it("decodes an auth key from base64", () => {
    const raw = new Uint8Array(32).fill(6);
    const decoded = authKeyBytesFromB64(base64Encode(raw));
    assert.deepEqual(decoded, raw);
  });

  it("builds stored-key hexes from auth and master secrets", () => {
    const authKey = new Uint8Array(32).fill(7);
    const masterKey = new Uint8Array(32).fill(8);
    const keys = proofKeysFromSecrets({
      authKeyB64: base64Encode(authKey),
      masterKey,
    });
    assert.equal(keys.authStoredKeyHex, loginStoredKeyHexFromAuthKey(authKey));
    assert.equal(
      keys.recoveryStoredKeyHex,
      recoveryStoredKeyHexFromMasterKey(masterKey),
    );
  });

  it("creates a login client proof that verifies", () => {
    const authKey = new Uint8Array(32).fill(9);
    const challengeId = "chal-1";
    const nonceB64 = base64Encode(new Uint8Array(16).fill(1));
    const proofB64 = loginClientProofB64(
      base64Encode(authKey),
      challengeId,
      nonceB64,
    );
    const expected = createLoginClientProof(
      authKey,
      loginAuthMessage(challengeId, nonceB64),
    );
    assert.equal(proofB64, base64Encode(expected));
    assert.equal(
      verifyClientProof(
        loginStoredKeyHexFromAuthKey(authKey),
        loginAuthMessage(challengeId, nonceB64),
        base64Decode(proofB64),
      ),
      true,
    );
  });

  it("creates a recovery client proof", () => {
    const masterKey = new Uint8Array(32).fill(2);
    const proofB64 = recoveryClientProofB64(masterKey, "ticket-1", "bm9uY2U=");
    assert.equal(typeof proofB64, "string");
    assert.ok(proofB64.length > 0);
    assert.equal(base64Decode(proofB64).length > 0, true);
  });
});
