import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { hashAuthKey } from "./verifier.js";
import {
  changeMasterPassword,
  initializeVault,
  regenerateRecoveryCodes,
  resetVaultFromRecovery,
} from "./vault-repo.js";
import { validateKdfParams, validateRecoveryEnvelopes } from "./kdf-params.js";
import { runMigrations } from "../db/migrations.js";
import { insertKeyEntry } from "../keys/key-entry-repo.js";
import { sha256Hex } from "./tokens.js";

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

function entryPayload(
  id: string,
  cipher = sampleCipher(),
  baseIvB64 = sampleCipher().ivB64,
) {
  return { id, baseIvB64, cipher };
}

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
              entryPayload(ENTRY_ID),
              entryPayload(ENTRY_ID),
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

  it("rejects when baseIvB64 does not match current cipher_iv", async () => {
    insertSampleEntry(db, ENTRY_ID);

    const beforeVersion = readKeyVersion(db);

    db.prepare(`UPDATE key_entries SET cipher_iv = ? WHERE id = ?`).run(
      Buffer.alloc(12, 99).toString("base64"),
      ENTRY_ID,
    );

    const newCipher = {
      algorithm: "aes-256-gcm" as const,
      ivB64: Buffer.alloc(12, 7).toString("base64"),
      ciphertextB64: Buffer.alloc(17, 8).toString("base64"),
    };

    await assert.rejects(
      async () => {
        changeMasterPassword(
          db,
          {
            kdf: sampleKdf(),
            authVerifier: "new-verifier",
            recoveryCodes: sampleRecoveryCodes(),
            entries: [entryPayload(ENTRY_ID, newCipher)],
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

    const entryRow = db
      .prepare(`SELECT cipher_iv, key_version FROM key_entries WHERE id = ?`)
      .get(ENTRY_ID) as { cipher_iv: string; key_version: number };

    assert.equal(entryRow.cipher_iv, Buffer.alloc(12, 99).toString("base64"));
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
          entries: [entryPayload(ENTRY_ID, newCipher)],
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
        entries: [entryPayload(entryId, newCipher)],
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

describe("resetVaultFromRecovery", () => {
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

  function insertOpenTicket(ticketPlain: string): void {
    const codeId = (
      db.prepare(`SELECT id FROM recovery_codes LIMIT 1`).get() as { id: string }
    ).id;
    const now = new Date();
    db.prepare(
      `INSERT INTO recovery_tickets (
         id, token_hash, recovery_code_id, created_at, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(
      "ticket-row-1",
      sha256Hex(ticketPlain),
      codeId,
      now.toISOString(),
      new Date(now.getTime() + 600_000).toISOString(),
    );
  }

  it("rejects when entries omit an existing key entry (vault unchanged)", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");
    const beforeVersion = readKeyVersion(db);

    await assert.rejects(
      async () => {
        resetVaultFromRecovery(
          db,
          {
            recoveryTicket: "recovery-ticket-token",
            kdf: sampleKdf(),
            authVerifier: await hashAuthKey(
              Buffer.alloc(32, 5).toString("base64"),
            ),
            recoveryCodes: sampleRecoveryCodes(),
            entries: [],
          },
          {},
          1200,
        );
      },
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Entry set does not match vault",
    );

    assert.equal(readKeyVersion(db), beforeVersion);
    const entryRow = db
      .prepare(`SELECT key_version FROM key_entries WHERE id = ?`)
      .get(ENTRY_ID) as { key_version: number };
    assert.equal(entryRow.key_version, 1);
  });

  it("re-encrypts entries and advances vault + entry key_version together", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");

    const newCipher = {
      algorithm: "aes-256-gcm" as const,
      ivB64: Buffer.alloc(12, 7).toString("base64"),
      ciphertextB64: Buffer.alloc(17, 8).toString("base64"),
    };

    const result = resetVaultFromRecovery(
      db,
      {
        recoveryTicket: "recovery-ticket-token",
        kdf: sampleKdf(),
        authVerifier: await hashAuthKey(
          Buffer.alloc(32, 5).toString("base64"),
        ),
        recoveryCodes: sampleRecoveryCodes(),
        entries: [entryPayload(ENTRY_ID, newCipher)],
      },
      {},
      1200,
    );

    assert.equal(result.keyVersion, 2);
    assert.equal(result.reEncrypted, 1);

    const entryRow = db
      .prepare(`SELECT cipher_iv, key_version FROM key_entries WHERE id = ?`)
      .get(ENTRY_ID) as { cipher_iv: string; key_version: number };
    assert.equal(entryRow.cipher_iv, newCipher.ivB64);
    assert.equal(entryRow.key_version, 2);
    assert.equal(readKeyVersion(db), 2);
  });
});
