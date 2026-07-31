import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AES_GCM_IV_BYTES,
  KEY_ENTRY_CIPHERTEXT_B64_MAX,
  KEY_ENTRY_TAGS_MAX,
} from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";
import {
  normalizeTags,
  validateCipherInput,
  validateService,
} from "./validate.js";

function assertInvalidRequest(fn: () => void, field: string): void {
  try {
    fn();
    assert.fail("expected HttpInvalidRequest");
  } catch (error) {
    assert.ok(error instanceof HttpInvalidRequest);
    assert.ok(
      error.details?.some((detail) => detail.field === field),
      `expected detail for ${field}`,
    );
  }
}

describe("key entry validate", () => {
  it("rejects iv of wrong byte length", () => {
    assertInvalidRequest(
      () =>
        validateCipherInput({
          algorithm: "aes-256-gcm",
          ivB64: Buffer.alloc(8).toString("base64"),
          ciphertextB64: Buffer.alloc(17).toString("base64"),
        }),
      "cipher.ivB64",
    );
  });

  it("rejects ciphertext shorter than the GCM tag", () => {
    assertInvalidRequest(
      () =>
        validateCipherInput({
          algorithm: "aes-256-gcm",
          ivB64: Buffer.alloc(AES_GCM_IV_BYTES).toString("base64"),
          ciphertextB64: Buffer.alloc(16).toString("base64"),
        }),
      "cipher.ciphertextB64",
    );
  });

  it("rejects oversized ciphertext", () => {
    assertInvalidRequest(
      () =>
        validateCipherInput({
          algorithm: "aes-256-gcm",
          ivB64: Buffer.alloc(AES_GCM_IV_BYTES).toString("base64"),
          ciphertextB64: Buffer.alloc(KEY_ENTRY_CIPHERTEXT_B64_MAX + 1).toString(
            "base64",
          ),
        }),
      "cipher.ciphertextB64",
    );
  });

  it("rejects unknown serviceId", () => {
    assertInvalidRequest(
      () => validateService("not-a-service", undefined),
      "serviceId",
    );
  });

  it("rejects serviceId custom with blank customServiceName", () => {
    assertInvalidRequest(
      () => validateService("custom", "   "),
      "customServiceName",
    );
  });

  it("dedupes tags and caps count", () => {
    const tags = normalizeTags([
      " alpha ",
      "Alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
      "iota",
      "kappa",
    ]);

    assert.equal(tags.length, KEY_ENTRY_TAGS_MAX);
    assert.deepEqual(tags.slice(0, 3), ["alpha", "beta", "gamma"]);
  });
});
