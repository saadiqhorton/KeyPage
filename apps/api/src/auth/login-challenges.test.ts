import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import {
  LOGIN_CHALLENGE_MAX_OPEN,
  LOGIN_CHALLENGE_TTL_SECONDS,
} from "@keypage/shared";

import { runMigrations } from "../db/migrations.js";
import { HttpRateLimited } from "../errors.js";
import {
  consumeLoginChallenge,
  createLoginChallenge,
} from "./login-challenges.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("login challenges", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(() => {
    db?.close();
  });

  it("issues a 32-byte standard-base64 nonce and consumes it once", () => {
    const issued = createLoginChallenge(db);
    const nonce = Buffer.from(issued.nonceB64, "base64");
    assert.equal(nonce.length, 32);
    assert.equal(nonce.toString("base64"), issued.nonceB64);

    const consumed = consumeLoginChallenge(
      db,
      issued.challengeId,
      issued.nonceB64,
    );
    assert.ok(consumed);
    assert.equal(consumed.id, issued.challengeId);
    assert.equal(consumed.nonce_b64, issued.nonceB64);

    assert.equal(
      consumeLoginChallenge(db, issued.challengeId, issued.nonceB64),
      null,
    );
  });

  it("rejects a wrong nonce and leaves the challenge available", () => {
    const issued = createLoginChallenge(db);
    const wrongNonce = Buffer.alloc(32, 1).toString("base64");

    assert.equal(
      consumeLoginChallenge(db, issued.challengeId, wrongNonce),
      null,
    );

    const consumed = consumeLoginChallenge(
      db,
      issued.challengeId,
      issued.nonceB64,
    );
    assert.ok(consumed);
  });

  it("does not consume an expired challenge", () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    db.prepare(
      `INSERT INTO login_challenges (id, nonce_b64, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      "expired-challenge",
      Buffer.alloc(32, 2).toString("base64"),
      expiredAt,
      expiredAt,
    );

    assert.equal(
      consumeLoginChallenge(
        db,
        "expired-challenge",
        Buffer.alloc(32, 2).toString("base64"),
      ),
      null,
    );
  });

  it("sweeps expired rows before applying the open-challenge cap", () => {
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    for (let i = 0; i < LOGIN_CHALLENGE_MAX_OPEN; i++) {
      db.prepare(
        `INSERT INTO login_challenges (id, nonce_b64, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
      ).run(
        `expired-${i}`,
        Buffer.alloc(32, i).toString("base64"),
        expiredAt,
        expiredAt,
      );
    }

    const issued = createLoginChallenge(db);
    assert.ok(issued.challengeId);

    const live = db
      .prepare(`SELECT COUNT(*) AS count FROM login_challenges`)
      .get() as { count: number };
    assert.equal(live.count, 1);
  });

  it("rejects a new challenge once the open-row cap is reached", () => {
    for (let i = 0; i < LOGIN_CHALLENGE_MAX_OPEN; i++) {
      createLoginChallenge(db);
    }

    assert.throws(
      () => createLoginChallenge(db),
      (error: unknown) =>
        error instanceof HttpRateLimited &&
        error.retryAfterSeconds === LOGIN_CHALLENGE_TTL_SECONDS,
    );
  });
});
