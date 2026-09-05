import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { newId, randomToken, sha256Hex } from "./tokens.js";

describe("tokens", () => {
  it("randomToken returns 32-byte base64url without padding", () => {
    const token = randomToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.notEqual(randomToken(), token);
  });

  it("sha256Hex hashes a known input", () => {
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("newId returns a UUID v4", () => {
    const id = newId();
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.notEqual(newId(), id);
  });
});
