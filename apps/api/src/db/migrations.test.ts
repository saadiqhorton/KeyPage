import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { deleteKeyEntry } from "../keys/key-entry-repo.js";
import { recordActivityEvent } from "../keys/activity-repo.js";
import { MIGRATIONS, runMigrations } from "./migrations.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function openDbAtVersion(version: number): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  for (const migration of MIGRATIONS) {
    if (migration.version > version) {
      break;
    }
    const apply = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
  }

  return db;
}

function insertVaultAuth(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO vault_auth (
       id, kdf_algorithm, kdf_memory_kib, kdf_iterations, kdf_parallelism,
       kdf_salt, auth_verifier, key_version, created_at, updated_at
     ) VALUES (1, 'pbkdf2-sha256', NULL, 100000, NULL, 'c2FsdA==', 'verifier', 1, ?, ?)`,
  ).run(now, now);
}

function insertKeyEntryRow(db: Database.Database, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO key_entries (
       id, label, service_id, custom_service_name, description, tags_json,
       cipher_algorithm, cipher_iv, cipher_text, key_version,
       created_at, updated_at, last_used_at
     ) VALUES (?, 'Test', 'openai', NULL, NULL, '[]', 'aes-256-gcm', 'aXY=', 'Y2lwaGVy', 1, ?, ?, NULL)`,
  ).run(id, now, now);
}

describe("migration v3 activity_events", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("drops rows with null key_entry_id during upgrade", () => {
    db = openDbAtVersion(2);
    const occurredAt = new Date().toISOString();
    const entryId = "11111111-1111-4111-8111-111111111111";

    insertKeyEntryRow(db, entryId);

    db.prepare(
      `INSERT INTO activity_events (id, key_entry_id, action, occurred_at)
       VALUES ('orphan', NULL, 'revealed', ?)`,
    ).run(occurredAt);
    db.prepare(
      `INSERT INTO activity_events (id, key_entry_id, action, occurred_at)
       VALUES ('kept', ?, 'created', ?)`,
    ).run(entryId, occurredAt);

    const migration = MIGRATIONS.find((entry) => entry.version === 3);
    assert.ok(migration);
    migration.up(db);
    db.pragma("user_version = 3");

    const rows = db
      .prepare(`SELECT id, key_entry_id FROM activity_events ORDER BY id`)
      .all() as Array<{ id: string; key_entry_id: string }>;

    assert.deepEqual(rows, [{ id: "kept", key_entry_id: entryId }]);
  });

  it("rebuilds activity_events without a foreign key", () => {
    db = openMemoryDb();

    const ddl = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activity_events'`,
      )
      .get() as { sql: string };

    assert.ok(!ddl.sql.includes("REFERENCES"));
    assert.ok(ddl.sql.includes("key_entry_id TEXT NOT NULL"));
  });

  it("creates occurred_at and key_entry indexes", () => {
    db = openMemoryDb();

    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = 'activity_events'
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;

    assert.deepEqual(
      indexes.map((index) => index.name),
      ["idx_activity_events_key_entry", "idx_activity_events_occurred_at"],
    );
  });

  it("keeps key_entry_id on delete tombstones", () => {
    db = openMemoryDb();
    insertVaultAuth(db);

    const entryId = "11111111-1111-4111-8111-111111111111";
    insertKeyEntryRow(db, entryId);

    const occurredAt = new Date().toISOString();
    recordActivityEvent(db, {
      keyEntryId: entryId,
      action: "deleted",
      occurredAt,
    });
    deleteKeyEntry(db, entryId, 1);

    const event = db
      .prepare(`SELECT key_entry_id, action FROM activity_events`)
      .get() as { key_entry_id: string; action: string };

    assert.equal(event.key_entry_id, entryId);
    assert.equal(event.action, "deleted");
    assert.equal(
      (
        db.prepare(`SELECT COUNT(*) AS count FROM key_entries`).get() as {
          count: number;
        }
      ).count,
      0,
    );
  });
});
