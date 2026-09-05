import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import fastifyCookie from "@fastify/cookie";
import Database from "better-sqlite3";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { SESSION_COOKIE_NAME } from "@keypage/shared";

import { createSession } from "../auth/sessions.js";
import { runMigrations } from "../db/migrations.js";
import { HttpError, toApiErrorBody } from "../errors.js";
import { createRequireSession } from "./require-session.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("createRequireSession", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  async function buildApp(idleSeconds = 1200): Promise<FastifyInstance> {
    app = Fastify({ logger: false });
    await app.register(fastifyCookie);
    app.setErrorHandler((error: FastifyError, _request, reply) => {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      return reply.status(statusCode).send(toApiErrorBody(error));
    });
    const requireSession = createRequireSession(db, () => idleSeconds);
    app.get("/secret", { preHandler: requireSession }, async (request) => ({
      sessionId: request.vaultSession?.id ?? null,
    }));
    await app.ready();
    return app;
  }

  it("rejects a request with no session cookie", async () => {
    await buildApp();
    const response = await app.inject({ method: "GET", url: "/secret" });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "unauthenticated");
  });

  it("rejects an unknown session token and clears the cookie", async () => {
    await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/secret",
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-session` },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "unauthenticated");
    const setCookie = response.headers["set-cookie"];
    assert.ok(setCookie);
  });

  it("attaches the resolved session when the cookie is valid", async () => {
    await buildApp();
    const { token } = createSession(db, {}, 1200);
    const response = await app.inject({
      method: "GET",
      url: "/secret",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.json().sessionId, "string");
    assert.ok(response.json().sessionId.length > 0);
  });

  it("reports session_expired for idle sessions", async () => {
    await buildApp(1);
    const { token } = createSession(db, {}, 1);
    const row = db
      .prepare(`SELECT id FROM sessions WHERE token_hash IS NOT NULL`)
      .get() as { id: string };
    db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(
      new Date(Date.now() - 5000).toISOString(),
      row.id,
    );

    const response = await app.inject({
      method: "GET",
      url: "/secret",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "session_expired");
  });

  it("reports session_expired for revoked sessions", async () => {
    await buildApp();
    const { token } = createSession(db, {}, 1200);
    db.prepare(`UPDATE sessions SET revoked_at = ?`).run(new Date().toISOString());

    const response = await app.inject({
      method: "GET",
      url: "/secret",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "session_expired");
  });
});
