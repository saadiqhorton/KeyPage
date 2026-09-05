import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import fastifyCookie from "@fastify/cookie";
import Database from "better-sqlite3";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { SESSION_COOKIE_NAME, loginStoredKeyHexFromAuthKey } from "@keypage/shared";

import { createSession } from "../auth/sessions.js";
import { initializeVault } from "../auth/vault-repo.js";
import { runMigrations } from "../db/migrations.js";
import { HttpError, toApiErrorBody } from "../errors.js";
import { vaultRoutes } from "./vault.js";

const AUTH_KEY = new Uint8Array(32).fill(7);

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

async function buildTestApp(
  db: Database.Database,
  initialized: boolean,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return reply.status(statusCode).send(toApiErrorBody(error));
  });
  await app.register(vaultRoutes, {
    prefix: "/api/vault",
    db,
    setupGate: {
      token: initialized ? null : "token",
      filePath: "",
      verify: () => false,
      consume: async () => {},
    },
  });
  await app.ready();
  return app;
}

describe("vault session, lock, and recovery claim edges", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  async function startUninitialized(): Promise<void> {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    app = await buildTestApp(db, false);
  }

  async function startReady(): Promise<string> {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    initializeVault(db, {
      kdf: sampleKdf(),
      proofKeys: {
        authStoredKeyHex: loginStoredKeyHexFromAuthKey(AUTH_KEY),
        recoveryStoredKeyHex: Buffer.alloc(32, 8).toString("hex"),
      },
      recoveryCodes: sampleRecoveryCodes(),
    });
    app = await buildTestApp(db, true);
    const { token } = createSession(db, {}, 1200);
    return token;
  }

  it("reports setup_required status and unauthenticated session before init", async () => {
    await startUninitialized();

    const status = await app.inject({ method: "GET", url: "/api/vault/status" });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().state, "setup_required");
    assert.equal(status.json().session.authenticated, false);
    assert.equal(status.json().proofReady, false);

    const session = await app.inject({ method: "GET", url: "/api/vault/session" });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().authenticated, false);
    assert.equal(session.json().idleSecondsRemaining, 0);
    assert.equal(session.json().absoluteExpiresAt, null);

    const challenge = await app.inject({
      method: "POST",
      url: "/api/vault/login/challenge",
    });
    assert.equal(challenge.statusCode, 409);
    assert.equal(challenge.json().error, "setup_required");

    const login = await app.inject({
      method: "POST",
      url: "/api/vault/login",
      payload: {},
    });
    assert.equal(login.statusCode, 409);

    const claim = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/claim",
      payload: { lookupHash: "a".repeat(64) },
    });
    assert.equal(claim.statusCode, 409);
  });

  it("returns an authenticated session, accepts touch, and lock revokes it", async () => {
    const token = await startReady();
    const cookie = `${SESSION_COOKIE_NAME}=${token}`;

    const status = await app.inject({
      method: "GET",
      url: "/api/vault/status",
      headers: { cookie },
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().state, "ready");
    assert.equal(status.json().session.authenticated, true);

    const session = await app.inject({
      method: "GET",
      url: "/api/vault/session",
      headers: { cookie },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().authenticated, true);
    assert.equal(typeof session.json().absoluteExpiresAt, "string");
    assert.ok(session.json().idleSecondsRemaining > 0);

    const touch = await app.inject({
      method: "POST",
      url: "/api/vault/session/touch",
      headers: { cookie },
    });
    assert.equal(touch.statusCode, 204);

    const lock = await app.inject({
      method: "POST",
      url: "/api/vault/lock",
      headers: { cookie },
    });
    assert.equal(lock.statusCode, 204);

    const after = await app.inject({
      method: "GET",
      url: "/api/vault/session",
      headers: { cookie },
    });
    assert.equal(after.json().authenticated, false);
  });

  it("clears a stale cookie on status and session, and lock is a no-op without one", async () => {
    await startReady();
    const cookie = `${SESSION_COOKIE_NAME}=not-a-real-token`;

    const status = await app.inject({
      method: "GET",
      url: "/api/vault/status",
      headers: { cookie },
    });
    assert.equal(status.json().session.authenticated, false);
    assert.ok(status.headers["set-cookie"]);

    const session = await app.inject({
      method: "GET",
      url: "/api/vault/session",
      headers: { cookie },
    });
    assert.equal(session.json().authenticated, false);

    const lock = await app.inject({ method: "POST", url: "/api/vault/lock" });
    assert.equal(lock.statusCode, 204);
  });

  it("rejects an invalid recovery lookupHash and an unknown code", async () => {
    await startReady();

    const invalid = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/claim",
      payload: { lookupHash: "not-hex" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "invalid_request");

    const unknown = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/claim",
      payload: { lookupHash: "f".repeat(64) },
    });
    assert.equal(unknown.statusCode, 401);
    assert.equal(unknown.json().error, "invalid_recovery_code");
    assert.equal(typeof unknown.json().attemptsRemaining, "number");
  });

  it("rejects login without a proof on a proof-ready vault", async () => {
    await startReady();
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/login",
      payload: {},
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.json().message, /Login proof is required/);
  });
});
