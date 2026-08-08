import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { hashAuthKey } from "./verifier.js";
import {
  assertKeyEntryMutationsAllowed,
  changeMasterPassword,
  claimRecoveryCode,
  hasOpenRecoveryTicket,
  initializeVault,
  regenerateRecoveryCodes,
  resetVaultFromRecovery,
} from "./vault-repo.js";
import { createSession, isSessionActive, revokeAllSessions } from "./sessions.js";
import { validateKdfParams, validateRecoveryEnvelopes } from "./kdf-params.js";
import { runMigrations } from "../db/migrations.js";
import { insertKeyEntry } from "../keys/key-entry-repo.js";
import {
  HttpInvalidRecoveryTicket,
  HttpInvalidRequest,
  HttpKeyVersionMismatch,
  HttpSessionExpired,
} from "../errors.js";
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

/** Rotation payload: no key version, because the server mints it. */
function samplePayload() {
  return {
    algorithm: "aes-256-gcm" as const,
    ivB64: Buffer.alloc(12, 3).toString("base64"),
    ciphertextB64: Buffer.alloc(17, 4).toString("base64"),
  };
}

/** Client-authored write: declares the key version it was encrypted under. */
function sampleCipher(keyVersion = 1) {
  return { ...samplePayload(), keyVersion };
}

const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ENTRY_ID = "22222222-2222-4222-8222-222222222222";

function insertSampleEntry(
  db: Database.Database,
  id: string,
  keyVersion = 1,
): void {
  insertKeyEntry(db, {
    id,
    label: "Test",
    serviceId: "openai",
    customServiceName: null,
    description: null,
    tags: [],
    cipher: sampleCipher(keyVersion),
  });
}

function sessionIdFor(db: Database.Database, token: string): string {
  return (
    db.prepare(`SELECT id FROM sessions WHERE token_hash = ?`).get(
      sha256Hex(token),
    ) as { id: string }
  ).id;
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
  cipher = samplePayload(),
  baseIvB64 = samplePayload().ivB64,
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

    assert.equal(entryRow.cipher_iv, samplePayload().ivB64);
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

  function newCodeSet() {
    return sampleRecoveryCodes().map((code, index) => ({
      ...code,
      label: `new-${index + 1}`,
    }));
  }

  function storedLabels(): string[] {
    return (
      db
        .prepare(`SELECT label FROM recovery_codes ORDER BY label`)
        .all() as Array<{ label: string }>
    ).map((row) => row.label);
  }

  it("replaces codes at current key version", () => {
    const { token } = createSession(db, {}, 1200);
    const newCodes = newCodeSet();

    const result = regenerateRecoveryCodes(db, {
      sessionId: sessionIdFor(db, token),
      keyVersion: 1,
      recoveryCodes: newCodes,
    });

    assert.equal(result.keyVersion, 1);
    assert.equal(result.recoveryCodesRemaining, 10);
    assert.deepEqual(storedLabels(), newCodes.map((code) => code.label).sort());
  });

  // The route awaits Argon2id verification before this call, so a rotation can
  // land in between. Envelopes wrap the master key, so persisting them against
  // the newer key version would hand the user recovery codes that unwrap the
  // *previous* master key and silently destroy every Key Entry.
  it("rejects envelopes pinned to a superseded key version", () => {
    const { token } = createSession(db, {}, 1200);
    const sessionId = sessionIdFor(db, token);
    const before = storedLabels();

    db.prepare(`UPDATE vault_auth SET key_version = 2 WHERE id = 1`).run();

    assert.throws(
      () =>
        regenerateRecoveryCodes(db, {
          sessionId,
          keyVersion: 1,
          recoveryCodes: newCodeSet(),
        }),
      (error: unknown) =>
        error instanceof HttpKeyVersionMismatch && error.statusCode === 409,
    );

    assert.deepEqual(storedLabels(), before);
  });

  it("rejects a session revoked mid-flight", () => {
    const { token } = createSession(db, {}, 1200);
    const sessionId = sessionIdFor(db, token);
    const before = storedLabels();

    revokeAllSessions(db);

    assert.throws(
      () =>
        regenerateRecoveryCodes(db, {
          sessionId,
          keyVersion: 1,
          recoveryCodes: newCodeSet(),
        }),
      (error: unknown) => error instanceof HttpSessionExpired,
    );

    assert.deepEqual(storedLabels(), before);
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

  it("revokes existing sessions before rotating entry ciphers", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");
    const { token } = createSession(db, {}, 1200);
    const sessionId = (
      db
        .prepare(`SELECT id FROM sessions WHERE token_hash = ?`)
        .get(sha256Hex(token)) as { id: string }
    ).id;

    assert.equal(isSessionActive(db, sessionId), true);

    resetVaultFromRecovery(
      db,
      {
        recoveryTicket: "recovery-ticket-token",
        kdf: sampleKdf(),
        authVerifier: await hashAuthKey(
          Buffer.alloc(32, 5).toString("base64"),
        ),
        recoveryCodes: sampleRecoveryCodes(),
        entries: [entryPayload(ENTRY_ID)],
      },
      {},
      1200,
    );

    assert.equal(isSessionActive(db, sessionId), false);
    assert.equal(hasOpenRecoveryTicket(db), false);
  });

  // The claim snapshot the client re-encrypts is taken before the reset lands.
  // These pin the property that any drift between the two aborts the whole
  // rotation, rather than silently rotating around the change.
  it("rejects a snapshot missing an entry added after the claim", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");

    const snapshot = [entryPayload(ENTRY_ID)];
    insertSampleEntry(db, SECOND_ENTRY_ID);

    await assert.rejects(
      async () =>
        resetVaultFromRecovery(
          db,
          {
            recoveryTicket: "recovery-ticket-token",
            kdf: sampleKdf(),
            authVerifier: await hashAuthKey(
              Buffer.alloc(32, 5).toString("base64"),
            ),
            recoveryCodes: sampleRecoveryCodes(),
            entries: snapshot,
          },
          {},
          1200,
        ),
      (error: unknown) =>
        error instanceof HttpInvalidRequest &&
        error.message === "Entry set does not match vault",
    );

    assert.equal(readKeyVersion(db), 1);
  });

  it("rejects a snapshot naming an entry deleted after the claim", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertSampleEntry(db, SECOND_ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");

    const snapshot = [entryPayload(ENTRY_ID), entryPayload(SECOND_ENTRY_ID)];
    db.prepare(`DELETE FROM key_entries WHERE id = ?`).run(SECOND_ENTRY_ID);

    await assert.rejects(
      async () =>
        resetVaultFromRecovery(
          db,
          {
            recoveryTicket: "recovery-ticket-token",
            kdf: sampleKdf(),
            authVerifier: await hashAuthKey(
              Buffer.alloc(32, 5).toString("base64"),
            ),
            recoveryCodes: sampleRecoveryCodes(),
            entries: snapshot,
          },
          {},
          1200,
        ),
      (error: unknown) =>
        error instanceof HttpInvalidRequest &&
        error.message === "Entry set does not match vault",
    );

    assert.equal(readKeyVersion(db), 1);
  });

  it("rejects a snapshot whose ciphertext changed after the claim", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");

    const snapshot = [entryPayload(ENTRY_ID)];
    const movedIv = Buffer.alloc(12, 42).toString("base64");
    db.prepare(`UPDATE key_entries SET cipher_iv = ? WHERE id = ?`).run(
      movedIv,
      ENTRY_ID,
    );

    await assert.rejects(
      async () =>
        resetVaultFromRecovery(
          db,
          {
            recoveryTicket: "recovery-ticket-token",
            kdf: sampleKdf(),
            authVerifier: await hashAuthKey(
              Buffer.alloc(32, 5).toString("base64"),
            ),
            recoveryCodes: sampleRecoveryCodes(),
            entries: snapshot,
          },
          {},
          1200,
        ),
      (error: unknown) =>
        error instanceof HttpInvalidRequest &&
        error.message === "Entry set does not match vault",
    );

    assert.equal(readKeyVersion(db), 1);
    const row = db
      .prepare(`SELECT cipher_iv FROM key_entries WHERE id = ?`)
      .get(ENTRY_ID) as { cipher_iv: string };
    assert.equal(row.cipher_iv, movedIv);
  });

  it("a recovery ticket is single-use", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");

    const newCipher = {
      algorithm: "aes-256-gcm" as const,
      ivB64: Buffer.alloc(12, 7).toString("base64"),
      ciphertextB64: Buffer.alloc(17, 8).toString("base64"),
    };

    resetVaultFromRecovery(
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

    assert.equal(readKeyVersion(db), 2);

    await assert.rejects(
      async () =>
        resetVaultFromRecovery(
          db,
          {
            recoveryTicket: "recovery-ticket-token",
            kdf: sampleKdf(),
            authVerifier: await hashAuthKey(
              Buffer.alloc(32, 6).toString("base64"),
            ),
            recoveryCodes: sampleRecoveryCodes(),
            entries: [entryPayload(ENTRY_ID, newCipher)],
          },
          {},
          1200,
        ),
      (error: unknown) => error instanceof HttpInvalidRecoveryTicket,
    );

    assert.equal(readKeyVersion(db), 2);
  });

  it("a successful reset leaves no ticket rows", async () => {
    insertSampleEntry(db, ENTRY_ID);
    insertOpenTicket("recovery-ticket-token");

    const newCipher = {
      algorithm: "aes-256-gcm" as const,
      ivB64: Buffer.alloc(12, 7).toString("base64"),
      ciphertextB64: Buffer.alloc(17, 8).toString("base64"),
    };

    resetVaultFromRecovery(
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

    // replaceRecoveryCodes cascade-deletes recovery_tickets via recovery_code_id FK.
    const ticketCount = (
      db.prepare(`SELECT COUNT(*) AS count FROM recovery_tickets`).get() as {
        count: number;
      }
    ).count;
    assert.equal(ticketCount, 0);
    assert.equal(hasOpenRecoveryTicket(db), false);
  });
});

describe("claimRecoveryCode", () => {
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

  it("claims a valid code, revokes sessions, and rejects reuse", () => {
    insertSampleEntry(db, ENTRY_ID);
    const { token } = createSession(db, {}, 1200);
    const sessionId = sessionIdFor(db, token);
    assert.equal(isSessionActive(db, sessionId), true);

    const lookupHash = sampleRecoveryCodes()[0]!.lookupHash;
    const throttleBefore = (
      db.prepare(`SELECT COUNT(*) AS count FROM auth_throttle`).get() as {
        count: number;
      }
    ).count;

    const result = claimRecoveryCode(db, lookupHash);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.claim.keyVersion, 1);
    assert.equal(result.claim.codesRemaining, 9);
    assert.equal(result.claim.entries.length, 1);
    assert.equal(hasOpenRecoveryTicket(db), true);
    assert.equal(isSessionActive(db, sessionId), false);

    const usedRow = db
      .prepare(`SELECT used_at FROM recovery_codes WHERE lookup_hash = ?`)
      .get(lookupHash) as { used_at: string | null };
    assert.notEqual(usedRow.used_at, null);

    const throttleAfter = (
      db.prepare(`SELECT COUNT(*) AS count FROM auth_throttle`).get() as {
        count: number;
      }
    ).count;
    assert.equal(throttleAfter, throttleBefore);

    const secondClaim = claimRecoveryCode(db, lookupHash);
    assert.deepEqual(secondClaim, { ok: false });

    const unknownClaim = claimRecoveryCode(db, "f".repeat(64));
    assert.deepEqual(unknownClaim, { ok: false });

    const ticketCount = (
      db.prepare(`SELECT COUNT(*) AS count FROM recovery_tickets`).get() as {
        count: number;
      }
    ).count;
    assert.equal(ticketCount, 1);
  });
});

describe("assertKeyEntryMutationsAllowed", () => {
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

  it("rejects mutations when the session was revoked mid-flight", () => {
    const { token } = createSession(db, {}, 1200);
    const sessionId = (
      db
        .prepare(`SELECT id FROM sessions WHERE token_hash = ?`)
        .get(sha256Hex(token)) as { id: string }
    ).id;

    revokeAllSessions(db);

    assert.throws(
      () => assertKeyEntryMutationsAllowed(db, sessionId),
      (error: unknown) => error instanceof HttpSessionExpired,
    );
  });

  it("rejects mutations while an open recovery ticket exists", () => {
    const { token } = createSession(db, {}, 1200);
    const sessionId = (
      db
        .prepare(`SELECT id FROM sessions WHERE token_hash = ?`)
        .get(sha256Hex(token)) as { id: string }
    ).id;

    const codeId = (
      db.prepare(`SELECT id FROM recovery_codes LIMIT 1`).get() as { id: string }
    ).id;
    const now = new Date();
    db.prepare(
      `INSERT INTO recovery_tickets (
         id, token_hash, recovery_code_id, created_at, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(
      "open-ticket-1",
      sha256Hex("open-ticket-plain"),
      codeId,
      now.toISOString(),
      new Date(now.getTime() + 600_000).toISOString(),
    );

    assert.equal(hasOpenRecoveryTicket(db), true);
    assert.throws(
      () => assertKeyEntryMutationsAllowed(db, sessionId),
      (error: unknown) =>
        error instanceof HttpInvalidRequest &&
        error.message === "Vault recovery in progress",
    );
  });
});
