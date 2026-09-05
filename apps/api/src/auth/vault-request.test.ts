import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpInvalidRequest } from "../errors.js";
import {
  validateAuthKeyB64,
  validateClientProofB64,
} from "./vault-request.js";

const valid32 = Buffer.alloc(32, 9).toString("base64");

describe("validateAuthKeyB64 / validateClientProofB64", () => {
  it("accepts standard base64 that decodes to 32 bytes", () => {
    assert.doesNotThrow(() => validateAuthKeyB64(valid32));
    assert.doesNotThrow(() =>
      validateClientProofB64(valid32, "clientProofB64"),
    );
  });

  it("rejects non-base64 and URL-safe base64", () => {
    assert.throws(
      () => validateAuthKeyB64("not-valid!!!"),
      (error: unknown) => error instanceof HttpInvalidRequest,
    );
    assert.throws(
      () => validateClientProofB64(Buffer.alloc(32, 9).toString("base64url"), "clientProofB64"),
      (error: unknown) => error instanceof HttpInvalidRequest,
    );
  });

  it("rejects valid base64 that is not 32 bytes", () => {
    assert.throws(
      () => validateAuthKeyB64(Buffer.alloc(16, 1).toString("base64")),
      (error: unknown) =>
        error instanceof HttpInvalidRequest &&
        error.details?.[0]?.message === "must decode to exactly 32 bytes",
    );
  });
});
