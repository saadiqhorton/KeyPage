import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HttpError,
  HttpInternalError,
  HttpInvalidCredentials,
  HttpInvalidRecoveryCode,
  HttpInvalidRecoveryTicket,
  HttpInvalidRequest,
  HttpInvalidSetupToken,
  HttpKeyVersionMismatch,
  HttpRateLimited,
  HttpSessionExpired,
  HttpSetupRequired,
  HttpUnauthenticated,
  HttpVaultAlreadyInitialized,
  toApiErrorBody,
} from "./errors.js";

describe("HttpError subclasses", () => {
  it("HttpInvalidRequest includes optional field details", () => {
    const error = new HttpInvalidRequest("bad field", [
      { field: "label", message: "required" },
    ]);

    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "invalid_request");
    assert.deepEqual(error.details, [{ field: "label", message: "required" }]);
    assert.deepEqual(toApiErrorBody(error), {
      error: "invalid_request",
      message: "bad field",
      details: [{ field: "label", message: "required" }],
    });
  });

  it("setup and vault-already-initialized use 409 defaults", () => {
    const setup = new HttpSetupRequired();
    const already = new HttpVaultAlreadyInitialized();

    assert.equal(setup.statusCode, 409);
    assert.equal(setup.code, "setup_required");
    assert.equal(setup.message, "Vault setup is required");
    assert.equal(already.code, "vault_already_initialized");
    assert.equal(already.message, "Vault is already initialized");
  });

  it("credential and recovery-code errors expose attemptsRemaining", () => {
    const credentials = new HttpInvalidCredentials("wrong", 3);
    const recovery = new HttpInvalidRecoveryCode("bad code", 2);

    assert.deepEqual(toApiErrorBody(credentials), {
      error: "invalid_credentials",
      message: "wrong",
      attemptsRemaining: 3,
    });
    assert.deepEqual(toApiErrorBody(recovery), {
      error: "invalid_recovery_code",
      message: "bad code",
      attemptsRemaining: 2,
    });
  });

  it("HttpRateLimited exposes retryAfterSeconds", () => {
    const error = new HttpRateLimited("slow down", 45);

    assert.equal(error.statusCode, 429);
    assert.deepEqual(toApiErrorBody(error), {
      error: "rate_limited",
      message: "slow down",
      retryAfterSeconds: 45,
    });
  });

  it("auth failure subclasses use 401 defaults", () => {
    assert.equal(new HttpUnauthenticated().code, "unauthenticated");
    assert.equal(new HttpSessionExpired().message, "Session expired");
    assert.equal(
      new HttpInvalidRecoveryTicket().message,
      "Recovery ticket is invalid or expired",
    );
    assert.equal(new HttpInvalidSetupToken().code, "invalid_setup_token");
  });

  it("HttpKeyVersionMismatch includes expected and received versions", () => {
    const error = new HttpKeyVersionMismatch({
      field: "cipher.keyVersion",
      expected: 2,
      received: 1,
    });

    assert.equal(error.statusCode, 409);
    assert.deepEqual(toApiErrorBody(error), {
      error: "key_version_mismatch",
      message: "Vault key version has changed",
      details: [
        {
          field: "cipher.keyVersion",
          message: "expected 2, received 1",
        },
      ],
    });
  });

  it("HttpInternalError and unknown errors map to internal_error", () => {
    const internal = new HttpInternalError();
    assert.equal(internal.statusCode, 500);
    assert.deepEqual(toApiErrorBody(internal), {
      error: "internal_error",
      message: "Internal server error",
    });

    assert.deepEqual(toApiErrorBody(new Error("boom")), {
      error: "internal_error",
      message: "Internal server error",
    });
  });

  it("HttpError name matches the constructor", () => {
    const error = new HttpError(418, "invalid_request", "teapot");
    assert.equal(error.name, "HttpError");
  });
});
