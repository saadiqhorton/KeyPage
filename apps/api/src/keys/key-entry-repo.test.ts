import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { loginStoredKeyHexFromAuthKey } from "@keypage/shared";

import { initializeVault } from "../auth/vault-repo.js";
import { runMigrations } from "../db/migrations.js";
import {
  HttpKeyVersionMismatch,
  HttpSetupRequired,
} from "../errors.js";
import {
  assertClientKeyVersion,
  deleteKeyEntry,
  getKeyEntry,
  insertKeyEntry,
  listKeyEntries,
  listKeyEntryCipherIvs,
  listKeyEntryIds,
  markKeyEntryUsed,
  replaceKeyEntryCiphers,
  updateKeyEntry,
} from "./key-entry-repo.js";

const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

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

function cipher(keyVersion: number, fill = 4) {
  return {
    algorithm: "aes-256-gcm" as const,
    ivB64: Buffer.alloc(12, fill).toString("base64"),
    ciphertextB64: Buffer.alloc(17, fill).toString("base64"),
    keyVersion,
  };
}

function openVaultDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  initializeVault(db, {
    kdf: sampleKdf(),
    proofKeys: {
      authStoredKeyHex: loginStoredKeyHexFromAuthKey(new Uint8Array(32).fill(9)),
      recoveryStoredKeyHex: Buffer.alloc(32, 8).toString("hex"),
    },
    recoveryCodes: sampleRecoveryCodes(),
  });
  return db;
}

describe("key-entry-repo", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openVaultDb();
  });

  afterEach(() => {
    db?.close();
  });

  it("inserts, lists, gets, updates metadata, marks used, and deletes", () => {
    const created = insertKeyEntry(db, {
      id: ENTRY_ID,
      label: "Primary",
      serviceId: "openai",
      customServiceName: null,
      description: "desc",
      tags: ["alpha"],
      cipher: cipher(1),
    });

    assert.equal(created.id, ENTRY_ID);
    assert.equal(created.label, "Primary");
    assert.deepEqual(created.tags, ["alpha"]);
    assert.equal(created.cipher.keyVersion, 1);

    insertKeyEntry(db, {
      id: OTHER_ID,
      label: "Second",
      serviceId: "openai",
      customServiceName: null,
      description: null,
      tags: [],
      cipher: cipher(1, 5),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      lastUsedAt: "2026-01-03T00:00:00.000Z",
    });

    const listed = listKeyEntries(db);
    assert.equal(listed.length, 2);
    assert.deepEqual([...listKeyEntryIds(db)].sort(), [ENTRY_ID, OTHER_ID].sort());
    assert.equal(listKeyEntryCipherIvs(db).get(ENTRY_ID), cipher(1).ivB64);

    const fetched = getKeyEntry(db, ENTRY_ID);
    assert.equal(fetched?.label, "Primary");
    assert.equal(getKeyEntry(db, "33333333-3333-4333-8333-333333333333"), null);

    const updated = updateKeyEntry(db, {
      id: ENTRY_ID,
      keyVersion: 1,
      label: "Renamed",
      serviceId: "openai",
      customServiceName: null,
      description: "updated",
      tags: ["beta"],
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    assert.equal(updated?.label, "Renamed");
    assert.equal(updated?.cipher.ivB64, cipher(1).ivB64);

    const used = markKeyEntryUsed(db, ENTRY_ID, "2026-03-01T00:00:00.000Z");
    assert.equal(used?.lastUsedAt, "2026-03-01T00:00:00.000Z");
    assert.equal(markKeyEntryUsed(db, "33333333-3333-4333-8333-333333333333", "x"), null);

    assert.equal(deleteKeyEntry(db, ENTRY_ID, 1), true);
    assert.equal(deleteKeyEntry(db, ENTRY_ID, 1), false);
    assert.equal(getKeyEntry(db, ENTRY_ID), null);
  });

  it("parses tags_json that is invalid or not a string array as empty tags", () => {
    insertKeyEntry(db, {
      id: ENTRY_ID,
      label: "Tagged",
      serviceId: "openai",
      customServiceName: null,
      description: null,
      tags: ["keep"],
      cipher: cipher(1),
    });

    db.prepare(`UPDATE key_entries SET tags_json = ? WHERE id = ?`).run(
      "{not-json",
      ENTRY_ID,
    );
    assert.deepEqual(getKeyEntry(db, ENTRY_ID)?.tags, []);

    db.prepare(`UPDATE key_entries SET tags_json = ? WHERE id = ?`).run(
      '{"nope":true}',
      ENTRY_ID,
    );
    assert.deepEqual(getKeyEntry(db, ENTRY_ID)?.tags, []);

    db.prepare(`UPDATE key_entries SET tags_json = ? WHERE id = ?`).run(
      '["ok", 1, "also"]',
      ENTRY_ID,
    );
    assert.deepEqual(getKeyEntry(db, ENTRY_ID)?.tags, ["ok", "also"]);
  });

  it("rejects writes when the vault is missing or the cipher version is stale", () => {
    const empty = new Database(":memory:");
    empty.pragma("foreign_keys = ON");
    runMigrations(empty);

    assert.throws(
      () =>
        insertKeyEntry(empty, {
          id: ENTRY_ID,
          label: "Nope",
          serviceId: "openai",
          customServiceName: null,
          description: null,
          tags: [],
          cipher: cipher(1),
        }),
      HttpSetupRequired,
    );
    assert.throws(() => assertClientKeyVersion(empty, 1), HttpSetupRequired);
    empty.close();

    insertKeyEntry(db, {
      id: ENTRY_ID,
      label: "Primary",
      serviceId: "openai",
      customServiceName: null,
      description: null,
      tags: [],
      cipher: cipher(1),
    });

    assert.throws(
      () =>
        insertKeyEntry(db, {
          id: OTHER_ID,
          label: "Stale",
          serviceId: "openai",
          customServiceName: null,
          description: null,
          tags: [],
          cipher: cipher(2),
        }),
      HttpKeyVersionMismatch,
    );

    assert.throws(() => assertClientKeyVersion(db, 9, "keyVersion"), (error: unknown) => {
      assert.ok(error instanceof HttpKeyVersionMismatch);
      assert.equal(error.details?.[0]?.field, "keyVersion");
      return true;
    });
  });

  it("replaces ciphers and rejects unknown update/delete ids", () => {
    insertKeyEntry(db, {
      id: ENTRY_ID,
      label: "Primary",
      serviceId: "openai",
      customServiceName: null,
      description: null,
      tags: [],
      cipher: cipher(1),
    });

    const replacement = {
      algorithm: "aes-256-gcm" as const,
      ivB64: Buffer.alloc(12, 9).toString("base64"),
      ciphertextB64: Buffer.alloc(17, 9).toString("base64"),
    };

    const updatedCount = replaceKeyEntryCiphers(
      db,
      [{ id: ENTRY_ID, baseIvB64: cipher(1).ivB64, cipher: replacement }],
      2,
    );
    assert.equal(updatedCount, 1);
    assert.equal(getKeyEntry(db, ENTRY_ID)?.cipher.ivB64, replacement.ivB64);
    assert.equal(getKeyEntry(db, ENTRY_ID)?.cipher.keyVersion, 2);

    db.prepare(`UPDATE vault_auth SET key_version = 2 WHERE id = 1`).run();

    const missingUpdate = updateKeyEntry(db, {
      id: OTHER_ID,
      keyVersion: 2,
      label: "Ghost",
      serviceId: "openai",
      customServiceName: null,
      description: null,
      tags: [],
      cipher: { ...replacement, keyVersion: 2 },
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    assert.equal(missingUpdate, null);
  });
});
