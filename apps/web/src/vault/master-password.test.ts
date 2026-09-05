import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { KdfParams } from "@keypage/shared";

import { ApiError } from "@/lib/api.js";
import { base64Encode } from "@/crypto/encoding.js";
import {
  MasterPasswordError,
  changeMasterPassword,
  completeVaultRecovery,
  formatPasswordError,
  regenerateRecoveryCodes,
} from "./master-password.js";

const FAST_KDF: KdfParams = {
  algorithm: "pbkdf2-sha256",
  saltB64: base64Encode(new Uint8Array(16).fill(3)),
  iterations: 1000,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("formatPasswordError", () => {
  it("returns MasterPasswordError messages as-is", () => {
    assert.equal(
      formatPasswordError(new MasterPasswordError("That's not your Master Password.")),
      "That's not your Master Password.",
    );
  });

  it("includes remaining attempts for invalid credentials", () => {
    assert.equal(
      formatPasswordError(
        new ApiError({
          error: "invalid_credentials",
          message: "nope",
          attemptsRemaining: 1,
        }),
      ),
      "Incorrect Master Password. 1 attempt remaining before a temporary lockout.",
    );
    assert.equal(
      formatPasswordError(
        new ApiError({
          error: "invalid_credentials",
          message: "nope",
          attemptsRemaining: 3,
        }),
      ),
      "Incorrect Master Password. 3 attempts remaining before a temporary lockout.",
    );
  });

  it("maps entry-set mismatch when configured", () => {
    const mismatch = new ApiError({
      error: "invalid_request",
      message: "Entry set does not match vault",
    });
    assert.equal(
      formatPasswordError(mismatch, { onEntryMismatch: "try again" }),
      "try again",
    );
    const details = new ApiError({
      error: "invalid_request",
      message: "bad",
      details: [{ field: "entries", message: "mismatch" }],
    });
    assert.equal(
      formatPasswordError(details, { onEntryMismatch: "retry" }),
      "retry",
    );
  });

  it("falls back to API, Error, and default messages", () => {
    assert.equal(
      formatPasswordError(new ApiError({ error: "internal_error", message: "boom" })),
      "boom",
    );
    assert.equal(formatPasswordError(new Error("plain")), "plain");
    assert.equal(formatPasswordError("weird"), "Something went wrong.");
    assert.equal(formatPasswordError("weird", { fallback: "custom" }), "custom");
  });
});

describe("changeMasterPassword early failures", () => {
  it("rejects an uninitialized vault", async () => {
    globalThis.fetch = async () => jsonResponse({ state: "setup_required", kdf: null });
    await assert.rejects(
      () => changeMasterPassword("old-password-12", "new-password-12"),
      /Vault is not initialized/,
    );
  });

  it("maps invalid credentials while enrolling a legacy vault", async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "/api/vault/status") {
        return jsonResponse({
          state: "unlocked",
          kdf: FAST_KDF,
          proofReady: false,
          keyVersion: 1,
        });
      }
      if (url === "/api/vault/login") {
        return jsonResponse(
          { error: "invalid_credentials", message: "nope" },
          401,
        );
      }
      return jsonResponse({});
    };

    await assert.rejects(
      () => changeMasterPassword("wrong-password", "new-password-12"),
      (error: unknown) => {
        assert.ok(error instanceof MasterPasswordError);
        assert.equal(error.message, "That's not your Master Password.");
        return true;
      },
    );
  });
});

describe("completeVaultRecovery early failures", () => {
  it("rejects an uninitialized vault", async () => {
    globalThis.fetch = async () => jsonResponse({ state: "setup_required", kdf: null });
    await assert.rejects(
      () =>
        completeVaultRecovery(
          "ticket",
          "nonce",
          new Uint8Array(32).fill(1),
          [],
          "new-password-12",
        ),
      /Vault is not initialized/,
    );
  });
});

describe("regenerateRecoveryCodes early failures", () => {
  it("rejects an uninitialized vault", async () => {
    globalThis.fetch = async () => jsonResponse({ state: "setup_required", kdf: null });
    await assert.rejects(
      () => regenerateRecoveryCodes("password-12-xx"),
      /Vault is not initialized/,
    );
  });
});
