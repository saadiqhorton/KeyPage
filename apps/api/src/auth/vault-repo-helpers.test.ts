import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { loginStoredKeyHexFromAuthKey } from "@keypage/shared";

import { runMigrations } from "../db/migrations.js";
import {
  HttpVaultAlreadyInitialized,
} from "../errors.js";
import {
  countUnusedRecoveryCodes,
  getVaultAuth,
  initializeVault,
  isVaultInitialized,
  rowToKdfParams,
} from "./vault-repo.js";

function sampleKdf() {
  return {
    algorithm: "pbkdf2-sha256" as const,
    saltB64: Buffer.alloc(16, 1).toString("base64"),
    iterations: 600_000,
  };
}

function sampleArgon2id() {
  return {
    algorithm: "argon2id" as const,
    saltB64: Buffer.alloc(16, 2).toString("base64"),
    iterations: 3,
    memoryKiB: 65536,
    parallelism: 1,
  };
}

function sampleRecoveryCodes(kdf = sampleKdf()) {
  return Array.from({ length: 10 }, (_, index) => ({
    label: `code-${index + 1}`,
    lookupHash: `${index.toString(16).padStart(2, "0")}${"0".repeat(62)}`,
    kdf,
    wrappedMasterKeyB64: Buffer.alloc(60, 2).toString("base64"),
  }));
}

function proofKeys() {
  return {
    authStoredKeyHex: loginStoredKeyHexFromAuthKey(new Uint8Array(32).fill(3)),
    recoveryStoredKeyHex: Buffer.alloc(32, 4).toString("hex"),
  };
}

describe("vault-repo helpers", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  afterEach(() => {
    db?.close();
  });

  it("rowToKdfParams maps pbkdf2 and argon2id columns", () => {
    assert.deepEqual(
      rowToKdfParams({
        kdf_algorithm: "pbkdf2-sha256",
        kdf_memory_kib: null,
        kdf_iterations: 600_000,
        kdf_parallelism: null,
        kdf_salt: "c2FsdA==",
      }),
      {
        algorithm: "pbkdf2-sha256",
        saltB64: "c2FsdA==",
        iterations: 600_000,
      },
    );

    assert.deepEqual(
      rowToKdfParams({
        kdf_algorithm: "argon2id",
        kdf_memory_kib: null,
        kdf_iterations: 3,
        kdf_parallelism: null,
        kdf_salt: "c2FsdA==",
      }),
      {
        algorithm: "argon2id",
        saltB64: "c2FsdA==",
        iterations: 3,
        memoryKiB: undefined,
        parallelism: undefined,
      },
    );

    assert.deepEqual(
      rowToKdfParams({
        kdf_algorithm: "argon2id",
        kdf_memory_kib: 65536,
        kdf_iterations: 3,
        kdf_parallelism: 1,
        kdf_salt: "c2FsdA==",
      }),
      {
        algorithm: "argon2id",
        saltB64: "c2FsdA==",
        iterations: 3,
        memoryKiB: 65536,
        parallelism: 1,
      },
    );
  });

  it("initializeVault persists auth and recovery codes, then rejects a second claim", () => {
    assert.equal(isVaultInitialized(db), false);
    initializeVault(db, {
      kdf: sampleArgon2id(),
      proofKeys: proofKeys(),
      recoveryCodes: sampleRecoveryCodes(sampleArgon2id()),
    });

    assert.equal(isVaultInitialized(db), true);
    const vault = getVaultAuth(db);
    assert.ok(vault);
    assert.deepEqual(rowToKdfParams(vault), sampleArgon2id());
    assert.equal(countUnusedRecoveryCodes(db), 10);

    assert.throws(
      () =>
        initializeVault(db, {
          kdf: sampleKdf(),
          proofKeys: proofKeys(),
          recoveryCodes: sampleRecoveryCodes(),
        }),
      HttpVaultAlreadyInitialized,
    );
  });

  it("getVaultAuth is undefined before setup", () => {
    assert.equal(getVaultAuth(db), undefined);
    assert.equal(countUnusedRecoveryCodes(db), 0);
  });
});
