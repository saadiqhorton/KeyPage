import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AES_GCM_IV_BYTES,
  ARGON2ID_RECOVERY_PARAMS,
  ARGON2ID_VAULT_PARAMS,
  AUTH_VERIFIER_PROOF_V1,
  BACKUP_AAD_PREFIX,
  DEFAULT_SESSION_IDLE_MINUTES,
  DERIVED_KEY_BYTES,
  HKDF_INFO_AUTH_KEY,
  HKDF_INFO_BACKUP_KEY,
  HKDF_INFO_ENCRYPTION_KEY,
  KDF_SALT_BYTES,
  LOGIN_FAILURE_WINDOW_SECONDS,
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_ATTEMPTS,
  MASTER_PASSWORD_MIN_LENGTH,
  PBKDF2_FALLBACK_ITERATIONS,
  RECOVERY_CODE_LOOKUP_PREFIX,
  RECOVERY_CODE_COUNT,
  RECOVERY_TICKET_TTL_SECONDS,
  RECOVERY_WRAP_AAD,
  SESSION_ABSOLUTE_HOURS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MINUTES_MAX,
  SESSION_IDLE_MINUTES_MIN,
  SESSION_IDLE_MINUTES_OPTIONS,
  SETUP_TOKEN_PATTERN,
} from "./vault.js";

describe("vault constants", () => {
  it("exports KDF and crypto sizing", () => {
    assert.deepEqual(ARGON2ID_VAULT_PARAMS, {
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
    });
    assert.deepEqual(ARGON2ID_RECOVERY_PARAMS, {
      memoryKiB: 19456,
      iterations: 2,
      parallelism: 1,
    });
    assert.equal(PBKDF2_FALLBACK_ITERATIONS, 600_000);
    assert.equal(KDF_SALT_BYTES, 16);
    assert.equal(DERIVED_KEY_BYTES, 32);
    assert.equal(AES_GCM_IV_BYTES, 12);
  });

  it("exports HKDF info strings and AAD prefixes", () => {
    assert.equal(HKDF_INFO_ENCRYPTION_KEY, "keypage:v1:encryption-key");
    assert.equal(HKDF_INFO_AUTH_KEY, "keypage:v1:auth-key");
    assert.equal(HKDF_INFO_BACKUP_KEY, "keypage:v1:backup-key");
    assert.equal(BACKUP_AAD_PREFIX, "keypage:v1:backup:");
    assert.equal(RECOVERY_WRAP_AAD, "keypage:v1:recovery-wrap");
    assert.equal(RECOVERY_CODE_LOOKUP_PREFIX, "keypage:v1:recovery-code:");
    assert.equal(AUTH_VERIFIER_PROOF_V1, "proof:v1");
  });

  it("exports session and login policy", () => {
    assert.equal(SESSION_COOKIE_NAME, "keypage_session");
    assert.equal(RECOVERY_CODE_COUNT, 10);
    assert.equal(LOGIN_MAX_ATTEMPTS, 5);
    assert.equal(LOGIN_LOCKOUT_SECONDS, 300);
    assert.equal(LOGIN_FAILURE_WINDOW_SECONDS, 900);
    assert.equal(DEFAULT_SESSION_IDLE_MINUTES, 20);
    assert.equal(SESSION_IDLE_MINUTES_MIN, 15);
    assert.equal(SESSION_IDLE_MINUTES_MAX, 30);
    assert.deepEqual(SESSION_IDLE_MINUTES_OPTIONS, [15, 20, 25, 30]);
    assert.equal(MASTER_PASSWORD_MIN_LENGTH, 12);
    assert.equal(SESSION_ABSOLUTE_HOURS, 12);
    assert.equal(RECOVERY_TICKET_TTL_SECONDS, 600);
  });

  it("matches setup tokens minted as base64url of 32 bytes", () => {
    const pattern = new RegExp(SETUP_TOKEN_PATTERN);
    const validToken = Buffer.from(new Uint8Array(32).fill(1)).toString(
      "base64url",
    );
    assert.equal(validToken.length, 43);
    assert.match(validToken, pattern);
    assert.doesNotMatch("too-short", pattern);
    assert.doesNotMatch(`${validToken}+`, pattern);
  });
});
