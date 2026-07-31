import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hashAuthKey, verifyAuthKey } from "./verifier.js";

describe("auth verifier", () => {
  it("round-trips authKeyB64 through PHC hash and verify", async () => {
    const authKeyB64 = Buffer.alloc(32, 7).toString("base64");
    const phc = await hashAuthKey(authKeyB64);

    assert.match(phc, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyAuthKey(authKeyB64, phc), true);
  });

  it("rejects a wrong authKeyB64", async () => {
    const authKeyB64 = Buffer.alloc(32, 3).toString("base64");
    const wrongKeyB64 = Buffer.alloc(32, 4).toString("base64");
    const phc = await hashAuthKey(authKeyB64);

    assert.equal(await verifyAuthKey(wrongKeyB64, phc), false);
  });
});
