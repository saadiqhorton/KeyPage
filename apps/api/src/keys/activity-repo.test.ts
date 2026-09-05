import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { runMigrations } from "../db/migrations.js";
import { recordActivityEvent } from "./activity-repo.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("recordActivityEvent", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(() => {
    db?.close();
  });

  it("inserts created, edited, revealed, copied, and deleted events", () => {
    const keyEntryId = "11111111-1111-4111-8111-111111111111";
    const occurredAt = "2026-09-05T12:00:00.000Z";
    const actions = ["created", "edited", "revealed", "copied", "deleted"] as const;

    for (const action of actions) {
      recordActivityEvent(db, { keyEntryId, action, occurredAt });
    }

    const rows = db
      .prepare(
        `SELECT key_entry_id, action, occurred_at FROM activity_events ORDER BY action`,
      )
      .all() as Array<{
      key_entry_id: string;
      action: string;
      occurred_at: string;
    }>;

    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.map((row) => row.action),
      ["copied", "created", "deleted", "edited", "revealed"],
    );
    for (const row of rows) {
      assert.equal(row.key_entry_id, keyEntryId);
      assert.equal(row.occurred_at, occurredAt);
    }
  });

  it("assigns a unique id per event", () => {
    const keyEntryId = "22222222-2222-4222-8222-222222222222";
    recordActivityEvent(db, {
      keyEntryId,
      action: "created",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    recordActivityEvent(db, {
      keyEntryId,
      action: "created",
      occurredAt: "2026-01-01T00:00:01.000Z",
    });

    const ids = db
      .prepare(`SELECT id FROM activity_events`)
      .all() as Array<{ id: string }>;

    assert.equal(ids.length, 2);
    assert.notEqual(ids[0]?.id, ids[1]?.id);
    assert.match(ids[0]!.id, /^[0-9a-f-]{36}$/i);
  });
});
