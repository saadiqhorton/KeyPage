import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKUP_FORMAT_VERSION,
  BACKUP_KDF_MAX_ARGON2ID_ITERATIONS,
  BACKUP_KDF_MAX_MEMORY_KIB,
  BACKUP_KDF_MAX_PBKDF2_ITERATIONS,
  BACKUP_MAGIC,
  BACKUP_MAX_ENTRIES,
  isExportedBackupKdf,
} from "./backup.js";
import {
  ARGON2ID_VAULT_PARAMS,
  PBKDF2_FALLBACK_ITERATIONS,
} from "./vault.js";

describe("backup constants", () => {
  it("exports v1 backup limits", () => {
    assert.equal(BACKUP_MAGIC, "keypage-backup");
    assert.equal(BACKUP_FORMAT_VERSION, 1);
    assert.equal(BACKUP_MAX_ENTRIES, 500);
    assert.equal(BACKUP_KDF_MAX_MEMORY_KIB, 262_144);
    assert.equal(BACKUP_KDF_MAX_ARGON2ID_ITERATIONS, 10);
    assert.equal(BACKUP_KDF_MAX_PBKDF2_ITERATIONS, 2_000_000);
  });
});

describe("isExportedBackupKdf", () => {
  it("accepts the vault argon2id preset", () => {
    assert.equal(
      isExportedBackupKdf({
        algorithm: "argon2id",
        saltB64: "abc",
        iterations: ARGON2ID_VAULT_PARAMS.iterations,
        memoryKiB: ARGON2ID_VAULT_PARAMS.memoryKiB,
        parallelism: ARGON2ID_VAULT_PARAMS.parallelism,
      }),
      true,
    );
  });

  it("accepts the pbkdf2 fallback iteration count", () => {
    assert.equal(
      isExportedBackupKdf({
        algorithm: "pbkdf2-sha256",
        saltB64: "abc",
        iterations: PBKDF2_FALLBACK_ITERATIONS,
      }),
      true,
    );
  });

  it("rejects non-exported argon2id params", () => {
    assert.equal(
      isExportedBackupKdf({
        algorithm: "argon2id",
        saltB64: "abc",
        iterations: 99,
        memoryKiB: ARGON2ID_VAULT_PARAMS.memoryKiB,
        parallelism: ARGON2ID_VAULT_PARAMS.parallelism,
      }),
      false,
    );
  });

  it("rejects non-exported pbkdf2 iterations", () => {
    assert.equal(
      isExportedBackupKdf({
        algorithm: "pbkdf2-sha256",
        saltB64: "abc",
        iterations: 100_000,
      }),
      false,
    );
  });
});
