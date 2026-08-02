import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
  DEFAULT_SESSION_IDLE_MINUTES,
  SESSION_IDLE_MINUTES_OPTIONS,
} from "@keypage/shared";

import { hashAuthKey } from "./auth/verifier.js";
import {
  changeMasterPassword,
  initializeVault,
  regenerateRecoveryCodes,
} from "./auth/vault-repo.js";
import { runMigrations } from "./db/migrations.js";
import { insertKeyEntry } from "./keys/key-entry-repo.js";
import {
  clampClipboardClearSeconds,
  describeIdleTimeout,
  isIdleMinutesOption,
  readIdleTimeoutSetting,
  writeIdleTimeoutSetting,
} from "./settings.js";
import { validateKdfParams, validateRecoveryEnvelopes } from "./auth/kdf-params.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function sampleKdf() {
  return {
    algorithm: "pbkdf2-sha256" as const,
    saltB64: Buffer.alloc(16, 1).toString("base64"),
    iterations: 600_000,
  };
}

function sampleRecoveryCodes() {
  return Array.from({ length: 10 }, (_, index) => ({
    label: `code-${index + 1}`,
    lookupHash: `${index.toString(16).padStart(2, "0")}${"0".repeat(62)}`,
    kdf: sampleKdf(),
    wrappedMasterKeyB64: Buffer.alloc(60, 2).toString("base64"),
  }));
}

function sampleCipher() {
  return {
    algorithm: "aes-256-gcm" as const,
    ivB64: Buffer.alloc(12, 3).toString("base64"),
    ciphertextB64: Buffer.alloc(17, 4).toString("base64"),
  };
}

const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ENTRY_ID = "22222222-2222-4222-8222-222222222222";

function insertSampleEntry(db: Database.Database, id: string): void {
  insertKeyEntry(db, {
    id,
    label: "Test",
    serviceId: "openai",
    customServiceName: null,
    description: null,
    tags: [],
    cipher: sampleCipher(),
  });
}

function readKeyVersion(db: Database.Database): number {
  return (
    db.prepare(`SELECT key_version FROM vault_auth WHERE id = 1`).get() as {
      key_version: number;
    }
  ).key_version;
}

describe("clampClipboardClearSeconds", () => {
  it("clamps below min", () => {
    assert.equal(clampClipboardClearSeconds(0), CLIPBOARD_CLEAR_SECONDS_MIN);
    assert.equal(clampClipboardClearSeconds(4), CLIPBOARD_CLEAR_SECONDS_MIN);
  });

  it("clamps above max", () => {
    assert.equal(clampClipboardClearSeconds(301), CLIPBOARD_CLEAR_SECONDS_MAX);
    assert.equal(clampClipboardClearSeconds(1000), CLIPBOARD_CLEAR_SECONDS_MAX);
  });

  it("rounds non-integer values", () => {
    assert.equal(clampClipboardClearSeconds(29.4), 29);
    assert.equal(clampClipboardClearSeconds(29.6), 30);
  });

  it("passes exact default through", () => {
    assert.equal(
      clampClipboardClearSeconds(DEFAULT_CLIPBOARD_CLEAR_SECONDS),
      DEFAULT_CLIPBOARD_CLEAR_SECONDS,
    );
  });
});

describe("isIdleMinutesOption", () => {
  it("accepts every offered option", () => {
    for (const minutes of SESSION_IDLE_MINUTES_OPTIONS) {
      assert.equal(isIdleMinutesOption(minutes), true);
    }
  });

  it("rejects in-band values that are not offered options", () => {
    assert.equal(isIdleMinutesOption(16), false);
    assert.equal(isIdleMinutesOption(22.5), false);
  });

  it("rejects values outside the offered range", () => {
    assert.equal(isIdleMinutesOption(14), false);
    assert.equal(isIdleMinutesOption(31), false);
    assert.equal(isIdleMinutesOption(0), false);
  });
});

describe("idle timeout settings", () => {
  let db: Database.Database;
  const originalEnv = process.env.KEYPAGE_SESSION_IDLE_MINUTES;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(() => {
    db?.close();
    if (originalEnv === undefined) {
      delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;
    } else {
      process.env.KEYPAGE_SESSION_IDLE_MINUTES = originalEnv;
    }
  });

  it("reads and writes database setting", () => {
    assert.equal(readIdleTimeoutSetting(db), 20);
    writeIdleTimeoutSetting(db, 25);
    assert.equal(readIdleTimeoutSetting(db), 25);
  });

  it("describeIdleTimeout prefers env over database", () => {
    writeIdleTimeoutSetting(db, 25);
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "18";

    assert.deepEqual(describeIdleTimeout(db), {
      minutes: 18,
      source: "env",
    });
  });

  it("describeIdleTimeout reports database source", () => {
    writeIdleTimeoutSetting(db, 25);
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;

    assert.deepEqual(describeIdleTimeout(db), {
      minutes: 25,
      source: "database",
    });
  });

  it("describeIdleTimeout reports default when unset", () => {
    db.prepare(`DELETE FROM app_settings WHERE key = 'session_idle_minutes'`).run();
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;

    assert.deepEqual(describeIdleTimeout(db), {
      minutes: DEFAULT_SESSION_IDLE_MINUTES,
      source: "default",
    });
  });
});

describe("changeMasterPassword", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = openMemoryDb();
    const kdf = sampleKdf();
    validateKdfParams(kdf);
    const recoveryCodes = sampleRecoveryCodes();
    validateRecoveryEnvelopes(recoveryCodes);
    const authVerifier = await hashAuthKey(
      Buffer.alloc(32, 9).toString("base64"),
    );
    initializeVault(db, { kdf, authVerifier, recoveryCodes });
  });

  afterEach(() => {
    db?.close();
  });

  it("rejects an entry set that is missing an existing entry", async () => {
    insertSampleEntry(db, ENTRY_ID);

    const beforeVersion = readKeyVersion(db);

    await assert.rejects(
      async () => {
        changeMasterPassword(
          db,
          {
            kdf: sampleKdf(),
            authVerifier: "new-verifier",
            recoveryCodes: sampleRecoveryCodes(),
            entries: [],
          },
          {},
          1200,
        );
      },
      (error: unknown) => {
        return (
          error instanceof Error &&
          error.message === "Entry set does not match vault"
        );
      },
    );

    assert.equal(readKeyVersion(db), beforeVersion);
  });

  it("rejects an entry set that submits the same id twice", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertSampleEntry(db, SECOND_ENTRY_ID);

    const beforeVersion = readKeyVersion(db);

    await assert.rejects(
      async () => {
        changeMasterPassword(
          db,
          {
            kdf: sampleKdf(),
            authVerifier: "new-verifier",
            recoveryCodes: sampleRecoveryCodes(),
            entries: [
              { id: ENTRY_ID, cipher: sampleCipher() },
              { id: ENTRY_ID, cipher: sampleCipher() },
            ],
          },
          {},
          1200,
        );
      },
      (error: unknown) => {
        return (
          error instanceof Error &&
          error.message === "Entry set does not match vault"
        );
      },
    );

    assert.equal(readKeyVersion(db), beforeVersion);
  });

  it("rolls back writes already made when a later statement fails", async () => {
    insertSampleEntry(db, ENTRY_ID);

    const beforeVersion = readKeyVersion(db);

    // Recovery codes are written after vault_auth and the entry ciphers, so a
    // UNIQUE violation here only rolls back if the whole change is one
    // transaction.
    const collidingCodes = sampleRecoveryCodes().map((code) => ({
      ...code,
      lookupHash: "ff".repeat(32),
    }));

    const newCipher = {
      algorithm: "aes-256-gcm" as const,
      ivB64: Buffer.alloc(12, 7).toString("base64"),
      ciphertextB64: Buffer.alloc(17, 8).toString("base64"),
    };

    await assert.rejects(async () => {
      changeMasterPassword(
        db,
        {
          kdf: sampleKdf(),
          authVerifier: "new-verifier",
          recoveryCodes: collidingCodes,
          entries: [{ id: ENTRY_ID, cipher: newCipher }],
        },
        {},
        1200,
      );
    });

    assert.equal(readKeyVersion(db), beforeVersion);

    const entryRow = db
      .prepare(`SELECT cipher_iv, key_version FROM key_entries WHERE id = ?`)
      .get(ENTRY_ID) as { cipher_iv: string; key_version: number };

    assert.equal(entryRow.cipher_iv, sampleCipher().ivB64);
    assert.equal(entryRow.key_version, beforeVersion);

    const codeLabels = (
      db.prepare(`SELECT label FROM recovery_codes`).all() as Array<{
        label: string;
      }>
    ).map((row) => row.label);

    assert.deepEqual(
      codeLabels.sort(),
      sampleRecoveryCodes()
        .map((code) => code.label)
        .sort(),
    );
  });

  it("updates vault, entries, and recovery codes on happy path", async () => {
    const entryId = ENTRY_ID;
    insertSampleEntry(db, entryId);

    const newCipher = {
      algorithm: "aes-256-gcm" as const,
      ivB64: Buffer.alloc(12, 7).toString("base64"),
      ciphertextB64: Buffer.alloc(17, 8).toString("base64"),
    };

    const result = changeMasterPassword(
      db,
      {
        kdf: sampleKdf(),
        authVerifier: await hashAuthKey(
          Buffer.alloc(32, 5).toString("base64"),
        ),
        recoveryCodes: sampleRecoveryCodes(),
        entries: [{ id: entryId, cipher: newCipher }],
      },
      {},
      1200,
    );

    assert.equal(result.keyVersion, 2);
    assert.equal(result.reEncrypted, 1);

    const row = db
      .prepare(`SELECT cipher_iv, key_version FROM key_entries WHERE id = ?`)
      .get(entryId) as { cipher_iv: string; key_version: number };

    assert.equal(row.cipher_iv, newCipher.ivB64);
    assert.equal(row.key_version, 2);
  });
});

describe("regenerateRecoveryCodes", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = openMemoryDb();
    const kdf = sampleKdf();
    const recoveryCodes = sampleRecoveryCodes();
    const authVerifier = await hashAuthKey(
      Buffer.alloc(32, 9).toString("base64"),
    );
    initializeVault(db, { kdf, authVerifier, recoveryCodes });
  });

  afterEach(() => {
    db?.close();
  });

  it("replaces codes at current key version", () => {
    const newCodes = sampleRecoveryCodes().map((code, index) => ({
      ...code,
      label: `new-${index + 1}`,
    }));

    const result = regenerateRecoveryCodes(db, newCodes);

    assert.equal(result.keyVersion, 1);
    assert.equal(result.recoveryCodesRemaining, 10);

    const labels = (
      db
        .prepare(`SELECT label FROM recovery_codes ORDER BY label`)
        .all() as Array<{ label: string }>
    ).map((row) => row.label);

    assert.deepEqual(labels, newCodes.map((code) => code.label).sort());
  });
});
