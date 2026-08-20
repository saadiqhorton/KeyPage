import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  clearEncryptionKey,
  getAuthProofKey,
  setEncryptionKey,
} from "./session-keys.js";

describe("session key material", () => {
  afterEach(() => clearEncryptionKey());

  it("keeps auth proof material only until the encryption key is cleared", () => {
    const authKey = Buffer.alloc(32, 7).toString("base64");
    setEncryptionKey(
      { kind: "fallback", bytes: new Uint8Array(32).fill(3) },
      1,
      authKey,
    );

    const retained = getAuthProofKey();
    assert.deepEqual(retained, new Uint8Array(32).fill(7));

    clearEncryptionKey();
    assert.equal(getAuthProofKey(), null);
    assert.deepEqual(retained, new Uint8Array(32));
  });

  it("zeroizes previously installed auth proof material on a second set", () => {
    setEncryptionKey(
      { kind: "fallback", bytes: new Uint8Array(32).fill(3) },
      1,
      Buffer.alloc(32, 7).toString("base64"),
    );
    const previous = getAuthProofKey()!;

    setEncryptionKey(
      { kind: "fallback", bytes: new Uint8Array(32).fill(4) },
      2,
      Buffer.alloc(32, 8).toString("base64"),
    );

    assert.deepEqual(previous, new Uint8Array(32));
    assert.deepEqual(getAuthProofKey(), new Uint8Array(32).fill(8));
  });
});
