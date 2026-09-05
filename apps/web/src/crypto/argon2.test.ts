import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { argon2idDerive, probeArgon2Wasm } from "./argon2.js";

describe("argon2", () => {
  it("probes wasm support", async () => {
    const available = await probeArgon2Wasm();
    assert.equal(typeof available, "boolean");
    assert.equal(await probeArgon2Wasm(), available);
  });

  it("derives a 32-byte hash", async () => {
    const hash = await argon2idDerive({
      password: "probe-password",
      salt: new Uint8Array(16).fill(3),
      memoryKiB: 1024,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
    });
    assert.equal(hash.length, 32);
    const again = await argon2idDerive({
      password: "probe-password",
      salt: new Uint8Array(16).fill(3),
      memoryKiB: 1024,
      iterations: 1,
      parallelism: 1,
    });
    assert.deepEqual(hash, again);
  });
});
