import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AES_GCM_IV_BYTES,
  KEY_ENTRY_CIPHERTEXT_B64_MAX,
  KEY_ENTRY_TAGS_MAX,
} from "@keypage/shared";

import { HttpInvalidRequest } from "../errors.js";
import {
  normalizeDescription,
  normalizeKeyEntryWriteFields,
  normalizeLabel,
  normalizeTags,
  normalizeImportTimestamp,
  validateCipherInput,
  validateCipherPayload,
  validateKeyEntryId,
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

function validPayload() {
  return {
    algorithm: "aes-256-gcm" as const,
    ivB64: Buffer.alloc(AES_GCM_IV_BYTES).toString("base64"),
    ciphertextB64: Buffer.alloc(17).toString("base64"),
  };
}

describe("key entry validate", () => {
  it("rejects iv of wrong byte length", () => {
    assertInvalidRequest(
      () =>
        validateCipherInput({
          ...validPayload(),
          ivB64: Buffer.alloc(8).toString("base64"),
          keyVersion: 1,
        }),
      "cipher.ivB64",
    );
  });

  it("rejects ciphertext shorter than the GCM tag", () => {
    assertInvalidRequest(
      () =>
        validateCipherInput({
          ...validPayload(),
          ciphertextB64: Buffer.alloc(16).toString("base64"),
          keyVersion: 1,
        }),
      "cipher.ciphertextB64",
    );
  });

  it("rejects oversized ciphertext", () => {
    assertInvalidRequest(
      () =>
        validateCipherInput({
          ...validPayload(),
          ciphertextB64: Buffer.alloc(KEY_ENTRY_CIPHERTEXT_B64_MAX + 1).toString(
            "base64",
          ),
          keyVersion: 1,
        }),
      "cipher.ciphertextB64",
    );
  });

  it("rejects a non-positive or fractional key version", () => {
    for (const keyVersion of [0, -1, 1.5, Number.NaN]) {
      assertInvalidRequest(
        () => validateCipherInput({ ...validPayload(), keyVersion }),
        "cipher.keyVersion",
      );
    }
  });

  it("accepts a well-formed client cipher", () => {
    assert.doesNotThrow(() =>
      validateCipherInput({ ...validPayload(), keyVersion: 3 }),
    );
  });

  it("accepts a rotation payload that carries no key version", () => {
    assert.doesNotThrow(() => validateCipherPayload(validPayload()));
  });

  it("rejects unknown serviceId", () => {
    assertInvalidRequest(
      () => validateService("not-a-service", undefined),
      "serviceId",
    );
  });

  it("accepts a catalog service and a custom service name", () => {
    assert.deepEqual(validateService("openai", undefined), {
      customServiceName: null,
    });
    assert.equal(
      validateService("custom", "My Service").customServiceName,
      "My Service",
    );
  });

  it("normalizes label and description", () => {
    assert.equal(normalizeLabel("  Hello  "), "Hello");
    assert.equal(normalizeDescription(undefined), null);
    assert.equal(normalizeDescription("  notes  "), "notes");
  });

  it("rejects a blank label", () => {
    assertInvalidRequest(() => normalizeLabel("   "), "label");
  });

  it("rejects an invalid key entry id", () => {
    assertInvalidRequest(() => validateKeyEntryId("not-a-uuid"), "id");
    assert.doesNotThrow(() =>
      validateKeyEntryId("11111111-1111-4111-8111-111111111111"),
    );
  });

  it("normalizeKeyEntryWriteFields returns trimmed fields", () => {
    const fields = normalizeKeyEntryWriteFields({
      label: "  API  ",
      serviceId: "openai",
      tags: [" one ", "one"],
    });
    assert.equal(fields.label, "API");
    assert.deepEqual(fields.tags, ["one"]);
    assert.equal(fields.customServiceName, null);
  });

  it("rejects an unknown cipher algorithm", () => {
    assertInvalidRequest(
      () =>
        validateCipherPayload({
          ...validPayload(),
          algorithm: "aes-128-gcm" as never,
        }),
      "cipher.algorithm",
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

describe("normalizeImportTimestamp", () => {
  it("maps undefined and null to null", () => {
    assert.equal(normalizeImportTimestamp(undefined, "createdAt"), null);
    assert.equal(normalizeImportTimestamp(null, "lastUsedAt"), null);
  });

  it("accepts a valid ISO timestamp", () => {
    const value = "2026-01-01T00:00:00.000Z";
    assert.equal(normalizeImportTimestamp(value, "createdAt"), value);
  });

  it("rejects a non-string timestamp", () => {
    assertInvalidRequest(
      () => normalizeImportTimestamp(12 as unknown as string, "createdAt"),
      "createdAt",
    );
  });

  it("rejects timestamps longer than 40 characters", () => {
    assertInvalidRequest(
      () =>
        normalizeImportTimestamp(
          "2026-01-01T00:00:00.000000000000000000000Z",
          "createdAt",
        ),
      "createdAt",
    );
  });

  it("rejects invalid timestamps", () => {
    assertInvalidRequest(
      () => normalizeImportTimestamp("not-a-date", "updatedAt"),
      "updatedAt",
    );
  });
});
