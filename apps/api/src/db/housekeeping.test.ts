import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { runMigrations } from "./migrations.js";
import { runHousekeeping } from "./housekeeping.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("runHousekeeping", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(() => {
    db?.close();
  });

  it("deletes expired sessions and expired recovery tickets", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const past = new Date(now.getTime() - 60_000).toISOString();
    const future = new Date(now.getTime() + 60_000).toISOString();

    db.prepare(
      `INSERT INTO sessions (
         id, token_hash, created_at, last_seen_at, absolute_expires_at, revoked_at
       ) VALUES
         ('expired', 'hash-expired', ?, ?, ?, NULL),
         ('live', 'hash-live', ?, ?, ?, NULL)`,
    ).run(past, past, past, future, future, future);

    db.prepare(
      `INSERT INTO recovery_codes (
         id, label, lookup_hash, kdf_algorithm, kdf_memory_kib, kdf_iterations,
         kdf_parallelism, kdf_salt, wrapped_master_key, key_version, created_at
       ) VALUES ('code-1', '1', '${"a".repeat(64)}', 'pbkdf2-sha256', NULL, 600000,
                 NULL, 'c2FsdA==', 'wrap', 1, ?)`,
    ).run(past);

    db.prepare(
      `INSERT INTO recovery_tickets (
         id, token_hash, recovery_code_id, created_at, expires_at, consumed_at
       ) VALUES
         ('expired-ticket', 'ticket-expired', 'code-1', ?, ?, NULL),
         ('live-ticket', 'ticket-live', 'code-1', ?, ?, NULL)`,
    ).run(past, past, future, future);

    runHousekeeping(db, now);

    const sessions = db
      .prepare(`SELECT id FROM sessions ORDER BY id`)
      .all() as Array<{ id: string }>;
    const tickets = db
      .prepare(`SELECT id FROM recovery_tickets ORDER BY id`)
      .all() as Array<{ id: string }>;

    assert.deepEqual(sessions.map((row) => row.id), ["live"]);
    assert.deepEqual(tickets.map((row) => row.id), ["live-ticket"]);
  });

  it("deletes revoked sessions older than the retention window", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    const oldRevoked = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const recentRevoked = new Date(now.getTime() - 60_000).toISOString();
    const future = new Date(now.getTime() + 60_000).toISOString();

    db.prepare(
      `INSERT INTO sessions (
         id, token_hash, created_at, last_seen_at, absolute_expires_at, revoked_at
       ) VALUES
         ('old-revoked', 'hash-old', ?, ?, ?, ?),
         ('new-revoked', 'hash-new', ?, ?, ?, ?)`,
    ).run(
      oldRevoked,
      oldRevoked,
      future,
      oldRevoked,
      recentRevoked,
      recentRevoked,
      future,
      recentRevoked,
    );

    runHousekeeping(db, now);

    const ids = db
      .prepare(`SELECT id FROM sessions ORDER BY id`)
      .all() as Array<{ id: string }>;
    assert.deepEqual(ids.map((row) => row.id), ["new-revoked"]);
  });
});
