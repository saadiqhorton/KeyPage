import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { runMigrations } from "../db/migrations.js";
import {
  assertNotLocked,
  readLockout,
  recordFailure,
  resetThrottle,
} from "./throttle.js";
import { HttpRateLimited } from "../errors.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("auth throttle", () => {
  let db: Database.Database;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = openMemoryDb();
    process.env.KEYPAGE_LOGIN_MAX_ATTEMPTS = "5";
    process.env.KEYPAGE_LOGIN_LOCKOUT_MINUTES = "5";
    process.env.KEYPAGE_LOGIN_FAILURE_WINDOW_SECONDS = "900";
  });

  afterEach(() => {
    db.close();
    process.env = { ...originalEnv };
  });

  it("locks after five failures and reports remaining attempts", () => {
    assert.deepEqual(readLockout(db, "login"), {
      locked: false,
      retryAfterSeconds: 0,
    });

    assert.equal(recordFailure(db, "login"), 4);
    assert.equal(recordFailure(db, "login"), 3);
    assert.equal(recordFailure(db, "login"), 2);
    assert.equal(recordFailure(db, "login"), 1);
    assert.equal(recordFailure(db, "login"), 0);

    const lockout = readLockout(db, "login");
    assert.equal(lockout.locked, true);
    assert.ok(lockout.retryAfterSeconds > 0);
    assert.throws(() => assertNotLocked(db, "login"), HttpRateLimited);
  });

  it("does not increment failures while locked", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(db, "login");
    }

    const before = db
      .prepare(`SELECT failed_count, lockout_count FROM auth_throttle WHERE scope = 'login'`)
      .get() as { failed_count: number; lockout_count: number };

    assert.equal(recordFailure(db, "login"), 0);
    assert.throws(() => assertNotLocked(db, "login"), HttpRateLimited);

    const after = db
      .prepare(`SELECT failed_count, lockout_count FROM auth_throttle WHERE scope = 'login'`)
      .get() as { failed_count: number; lockout_count: number };

    assert.deepEqual(after, before);
  });

  it("restarts the failure window after it expires", () => {
    const staleFirstFailure = new Date(
      Date.now() - 16 * 60 * 1000,
    ).toISOString();

    db.prepare(
      `UPDATE auth_throttle
       SET failed_count = 3,
           first_failed_at = ?,
           last_failed_at = ?
       WHERE scope = 'login'`,
    ).run(staleFirstFailure, staleFirstFailure);

    assert.equal(recordFailure(db, "login"), 4);

    const row = db
      .prepare(
        `SELECT failed_count, first_failed_at FROM auth_throttle WHERE scope = 'login'`,
      )
      .get() as { failed_count: number; first_failed_at: string };

    assert.equal(row.failed_count, 1);
    assert.ok(Date.parse(row.first_failed_at) > Date.parse(staleFirstFailure));
  });

  it("resets counters after success", () => {
    recordFailure(db, "login");
    recordFailure(db, "login");

    resetThrottle(db, "login");

    const row = db
      .prepare(
        `SELECT failed_count, first_failed_at, last_failed_at, locked_until
         FROM auth_throttle WHERE scope = 'login'`,
      )
      .get() as {
      failed_count: number;
      first_failed_at: string | null;
      last_failed_at: string | null;
      locked_until: string | null;
    };

    assert.equal(row.failed_count, 0);
    assert.equal(row.first_failed_at, null);
    assert.equal(row.last_failed_at, null);
    assert.equal(row.locked_until, null);
    assert.doesNotThrow(() => assertNotLocked(db, "login"));
  });

  it("keeps login and recovery scopes independent", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(db, "login");
    }

    assert.throws(() => assertNotLocked(db, "login"), HttpRateLimited);
    assert.doesNotThrow(() => assertNotLocked(db, "recovery"));
    assert.equal(recordFailure(db, "recovery"), 4);
  });

  it("clears an expired lockout on assertNotLocked and reports unlocked", () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    db.prepare(
      `UPDATE auth_throttle SET locked_until = ?, failed_count = 4 WHERE scope = 'login'`,
    ).run(expired);

    assert.deepEqual(readLockout(db, "login"), {
      locked: false,
      retryAfterSeconds: 0,
    });
    assert.doesNotThrow(() => assertNotLocked(db, "login"));

    const row = db
      .prepare(
        `SELECT locked_until, failed_count FROM auth_throttle WHERE scope = 'login'`,
      )
      .get() as { locked_until: string | null; failed_count: number };
    assert.equal(row.locked_until, null);
    assert.equal(row.failed_count, 0);
  });

  it("records a failure after an expired lockout window", () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    db.prepare(
      `UPDATE auth_throttle
       SET locked_until = ?, failed_count = 0, first_failed_at = NULL
       WHERE scope = 'login'`,
    ).run(expired);

    assert.equal(recordFailure(db, "login"), 4);
  });

  it("treats a missing throttle row as unlocked", () => {
    db.prepare(`DELETE FROM auth_throttle WHERE scope = 'login'`).run();
    assert.deepEqual(readLockout(db, "login"), {
      locked: false,
      retryAfterSeconds: 0,
    });
    assert.doesNotThrow(() => assertNotLocked(db, "login"));
  });
});
