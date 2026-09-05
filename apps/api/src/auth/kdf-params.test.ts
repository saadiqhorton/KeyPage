import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AES_GCM_IV_BYTES, DERIVED_KEY_BYTES, type KdfParams } from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";
import { validateKdfParams, validateRecoveryEnvelopes } from "./kdf-params.js";

const SALT_B64 = Buffer.alloc(16, 1).toString("base64");
const WRAPPED_MASTER_KEY_B64 = Buffer.alloc(
  AES_GCM_IV_BYTES + DERIVED_KEY_BYTES + 16,
  2,
).toString("base64");

function pbkdf2(overrides: Partial<KdfParams> = {}): KdfParams {
  return {
    algorithm: "pbkdf2-sha256",
    saltB64: SALT_B64,
    iterations: 600_000,
    ...overrides,
  };
}

function argon2id(overrides: Partial<KdfParams> = {}): KdfParams {
  return {
    algorithm: "argon2id",
    saltB64: SALT_B64,
    iterations: 3,
    memoryKiB: 65536,
    parallelism: 1,
    ...overrides,
  };
}

function assertInvalid(fn: () => void, field: string, messageIncludes?: string) {
  try {
    fn();
    assert.fail("expected HttpInvalidRequest");
  } catch (error) {
    assert.ok(error instanceof HttpInvalidRequest);
    const detail = error.details?.find((item) => item.field === field);
    assert.ok(detail, `expected detail for ${field}`);
    if (messageIncludes) {
      assert.match(detail.message, new RegExp(messageIncludes));
    }
  }
}

describe("validateKdfParams", () => {
  it("accepts in-range pbkdf2-sha256 params", () => {
    assert.doesNotThrow(() => validateKdfParams(pbkdf2()));
  });

  it("accepts in-range argon2id params", () => {
    assert.doesNotThrow(() => validateKdfParams(argon2id()));
  });

  it("rejects salt that does not decode to 16 bytes", () => {
    assertInvalid(
      () => validateKdfParams(pbkdf2({ saltB64: Buffer.alloc(8).toString("base64") })),
      "kdf.saltB64",
      "16 bytes",
    );
  });

  it("rejects argon2id without memoryKiB or parallelism", () => {
    assertInvalid(
      () => validateKdfParams(argon2id({ memoryKiB: undefined })),
      "kdf.memoryKiB",
      "required",
    );
    assertInvalid(
      () => validateKdfParams(argon2id({ parallelism: undefined })),
      "kdf.parallelism",
      "required",
    );
  });

  it("rejects argon2id values outside bounds", () => {
    assertInvalid(
      () => validateKdfParams(argon2id({ memoryKiB: 19455 })),
      "kdf.memoryKiB",
      "between",
    );
    assertInvalid(
      () => validateKdfParams(argon2id({ iterations: 1 })),
      "kdf.iterations",
      "between",
    );
    assertInvalid(
      () => validateKdfParams(argon2id({ parallelism: 5 })),
      "kdf.parallelism",
      "between",
    );
  });

  it("rejects pbkdf2-sha256 with memoryKiB or parallelism present", () => {
    assertInvalid(
      () => validateKdfParams(pbkdf2({ memoryKiB: 65536 })),
      "kdf.memoryKiB",
      "absent",
    );
    assertInvalid(
      () => validateKdfParams(pbkdf2({ parallelism: 1 })),
      "kdf.parallelism",
      "absent",
    );
  });

  it("rejects pbkdf2-sha256 iterations outside bounds", () => {
    assertInvalid(
      () => validateKdfParams(pbkdf2({ iterations: 299_999 })),
      "kdf.iterations",
      "between",
    );
  });

  it("rejects unsupported algorithms", () => {
    assertInvalid(
      () =>
        validateKdfParams({
          ...pbkdf2(),
          algorithm: "scrypt" as KdfParams["algorithm"],
        }),
      "kdf.algorithm",
      "unsupported",
    );
  });

  it("prefixes field names when fieldPrefix is provided", () => {
    assertInvalid(
      () => validateKdfParams(pbkdf2({ iterations: 1 }), "recoveryCodes[0].kdf"),
      "recoveryCodes[0].kdf.iterations",
    );
  });
});

describe("validateRecoveryEnvelopes", () => {
  function envelope(index: number, overrides: Record<string, unknown> = {}) {
    return {
      label: `code-${index + 1}`,
      lookupHash: `${index.toString(16).padStart(2, "0")}${"0".repeat(62)}`,
      kdf: pbkdf2(),
      wrappedMasterKeyB64: WRAPPED_MASTER_KEY_B64,
      ...overrides,
    };
  }

  it("accepts exactly ten unique well-formed envelopes", () => {
    assert.doesNotThrow(() =>
      validateRecoveryEnvelopes(Array.from({ length: 10 }, (_, i) => envelope(i))),
    );
  });

  it("rejects the wrong envelope count", () => {
    assertInvalid(
      () => validateRecoveryEnvelopes([envelope(0)]),
      "recoveryCodes",
      "exactly 10",
    );
  });

  it("rejects a non-hex lookup hash", () => {
    assertInvalid(
      () =>
        validateRecoveryEnvelopes(
          Array.from({ length: 10 }, (_, i) =>
            envelope(i, i === 0 ? { lookupHash: "ZZ" + "0".repeat(62) } : {}),
          ),
        ),
      "recoveryCodes[0].lookupHash",
    );
  });

  it("rejects duplicate lookup hashes", () => {
    assertInvalid(
      () =>
        validateRecoveryEnvelopes(
          Array.from({ length: 10 }, (_, i) =>
            envelope(i, { lookupHash: `${"a".repeat(64)}` }),
          ),
        ),
      "recoveryCodes[1].lookupHash",
      "unique",
    );
  });

  it("rejects wrappedMasterKeyB64 of the wrong length", () => {
    assertInvalid(
      () =>
        validateRecoveryEnvelopes(
          Array.from({ length: 10 }, (_, i) =>
            envelope(i, i === 2 ? { wrappedMasterKeyB64: Buffer.alloc(8).toString("base64") } : {}),
          ),
        ),
      "recoveryCodes[2].wrappedMasterKeyB64",
    );
  });
});
