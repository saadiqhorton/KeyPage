import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  base64Decode,
  base64Encode,
  base64urlDecode,
  base64urlEncode,
  hexDecode,
  hexEncode,
} from "./encoding.js";

describe("encoding", () => {
  it("round-trips every byte value through standard base64", () => {
    const data = Uint8Array.from({ length: 256 }, (_, index) => index);
    const encoded = base64Encode(data);
    assert.equal(encoded, Buffer.from(data).toString("base64"));
    assert.deepEqual(base64Decode(encoded), data);
  });

  it("encodes and decodes base64url without padding", () => {
    const data = Uint8Array.from([0xfb, 0xff, 0xef, 0x00, 0x7f]);
    const encoded = base64urlEncode(data);
    assert.equal(encoded.includes("+"), false);
    assert.equal(encoded.includes("/"), false);
    assert.equal(encoded.includes("="), false);
    assert.deepEqual(base64urlDecode(encoded), data);
  });

  it("round-trips hex for high bytes", () => {
    const data = Uint8Array.from([0x00, 0x0a, 0xff]);
    assert.equal(hexEncode(data), "000aff");
    assert.deepEqual(hexDecode("000aff"), data);
  });
});
