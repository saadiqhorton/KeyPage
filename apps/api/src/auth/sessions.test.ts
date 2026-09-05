import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { SESSION_ABSOLUTE_HOURS, SESSION_COOKIE_NAME } from "@keypage/shared";

import { runMigrations } from "../db/migrations.js";
import { sha256Hex } from "./tokens.js";
import {
  createSession,
  isSessionActive,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  touchSession,
} from "./sessions.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function sessionRow(db: Database.Database, token: string) {
  return db
    .prepare(
      `SELECT id, last_seen_at, absolute_expires_at, revoked_at, user_agent, ip
       FROM sessions WHERE token_hash = ?`,
    )
    .get(sha256Hex(token)) as {
    id: string;
    last_seen_at: string;
    absolute_expires_at: string;
    revoked_at: string | null;
    user_agent: string | null;
    ip: string | null;
  };
}

describe("sessions", () => {
  let db: Database.Database;
  const originalHours = process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS;

  beforeEach(() => {
    db = openMemoryDb();
    delete process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS;
  });

  afterEach(() => {
    db?.close();
    if (originalHours === undefined) {
      delete process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS;
    } else {
      process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS = originalHours;
    }
  });

  it("creates a session with hashed token, user agent, ip, and default lifetime", () => {
    const before = Date.now();
    const { token, info } = createSession(
      db,
      { headers: { "user-agent": "KeyPageTest/1.0" }, ip: "127.0.0.1" },
      1200,
    );
    const after = Date.now();

    assert.equal(typeof token, "string");
    assert.ok(token.length > 20);
    assert.equal(info.idleTimeoutSeconds, 1200);

    const row = sessionRow(db, token);
    assert.equal(row.user_agent, "KeyPageTest/1.0");
    assert.equal(row.ip, "127.0.0.1");
    assert.equal(row.revoked_at, null);

    const expectedMin = before + SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
    const expectedMax = after + SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000;
    const expires = Date.parse(row.absolute_expires_at);
    assert.ok(expires >= expectedMin - 1000);
    assert.ok(expires <= expectedMax + 1000);
    assert.equal(info.absoluteExpiresAt, row.absolute_expires_at);
  });

  it("honors KEYPAGE_SESSION_ABSOLUTE_HOURS and ignores invalid values", () => {
    process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS = "1";
    const { token } = createSession(db, {}, 1200);
    const row = sessionRow(db, token);
    const hours = (Date.parse(row.absolute_expires_at) - Date.now()) / 3_600_000;
    assert.ok(hours > 0.9 && hours < 1.1);

    process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS = "0";
    const fallback = createSession(db, {}, 1200);
    const fallbackHours =
      (Date.parse(sessionRow(db, fallback.token).absolute_expires_at) - Date.now()) /
      3_600_000;
    assert.ok(fallbackHours > SESSION_ABSOLUTE_HOURS - 0.2);
  });

  it("resolveSession reports missing, unknown, ok, revoked, expired, and idle", () => {
    assert.deepEqual(resolveSession(db, {}, 1200), { ok: false, reason: "missing" });
    assert.deepEqual(
      resolveSession(db, { cookies: { [SESSION_COOKIE_NAME]: "unknown" } }, 1200),
      { ok: false, reason: "unknown" },
    );

    const created = createSession(db, {}, 1200);
    const ok = resolveSession(
      db,
      { cookies: { [SESSION_COOKIE_NAME]: created.token } },
      1200,
    );
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(typeof ok.session.id, "string");
    }

    const row = sessionRow(db, created.token);
    revokeSession(db, row.id);
    assert.deepEqual(
      resolveSession(db, { cookies: { [SESSION_COOKIE_NAME]: created.token } }, 1200),
      { ok: false, reason: "revoked" },
    );

    const expired = createSession(db, {}, 1200);
    const expiredRow = sessionRow(db, expired.token);
    db.prepare(`UPDATE sessions SET absolute_expires_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 1000).toISOString(),
      expiredRow.id,
    );
    assert.deepEqual(
      resolveSession(db, { cookies: { [SESSION_COOKIE_NAME]: expired.token } }, 1200),
      { ok: false, reason: "expired" },
    );
    assert.equal(isSessionActive(db, expiredRow.id), false);

    const idle = createSession(db, {}, 1);
    const idleRow = sessionRow(db, idle.token);
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 5000).toISOString(),
      idleRow.id,
    );
    assert.deepEqual(
      resolveSession(db, { cookies: { [SESSION_COOKIE_NAME]: idle.token } }, 1),
      { ok: false, reason: "idle" },
    );
  });

  it("touchSession no-ops for unknown or recently seen sessions and updates stale ones", () => {
    touchSession(db, "missing-id");

    const { token } = createSession(db, {}, 1200);
    const row = sessionRow(db, token);
    const originalSeen = row.last_seen_at;
    touchSession(db, row.id);
    assert.equal(sessionRow(db, token).last_seen_at, originalSeen);

    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 20_000).toISOString(),
      row.id,
    );
    touchSession(db, row.id);
    assert.notEqual(sessionRow(db, token).last_seen_at, originalSeen);
    assert.equal(isSessionActive(db, row.id), true);
  });

  it("revokeAllSessions marks every live session revoked", () => {
    const first = createSession(db, {}, 1200);
    const second = createSession(db, {}, 1200);

    revokeAllSessions(db);

    assert.notEqual(sessionRow(db, first.token).revoked_at, null);
    assert.notEqual(sessionRow(db, second.token).revoked_at, null);
    assert.equal(isSessionActive(db, sessionRow(db, first.token).id), false);
  });

  it("isSessionActive is false for an unknown id", () => {
    assert.equal(isSessionActive(db, "missing"), false);
  });
});
