import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import fastifyCookie from "@fastify/cookie";
import Database from "better-sqlite3";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { SESSION_COOKIE_NAME } from "@keypage/shared";

import { createSession } from "../auth/sessions.js";
import { runMigrations } from "../db/migrations.js";
import { HttpError, toApiErrorBody } from "../errors.js";
import { settingsRoutes } from "./settings.js";

async function buildTestApp(db: Database.Database): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie);

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return reply.status(statusCode).send(toApiErrorBody(error));
  });

  await app.register(settingsRoutes, { prefix: "/api/settings", db });
  await app.ready();

  return app;
}

describe("PATCH /api/settings", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let cookie: string;
  const originalEnv = process.env.KEYPAGE_SESSION_IDLE_MINUTES;

  beforeEach(async () => {
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    app = await buildTestApp(db);
    const { token } = createSession(db, {}, 1200);
    cookie = `${SESSION_COOKIE_NAME}=${token}`;
  });

  afterEach(async () => {
    await app?.close();
    db?.close();
    if (originalEnv === undefined) {
      delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;
    } else {
      process.env.KEYPAGE_SESSION_IDLE_MINUTES = originalEnv;
    }
  });

  it("saves an offered option", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { sessionIdleMinutes: 25 },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      sessionIdleMinutes: 25,
      sessionIdleSource: "database",
      clipboardClearSeconds: 30,
    });
  });

  it("rejects a value that is in band but not an offered option", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { sessionIdleMinutes: 16 },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");
    assert.match(response.json().details[0].message, /must be one of 15, 20, 25, 30/);
  });

  it("rejects updates while the env var pins the timeout", async () => {
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "18";

    const response = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie },
      payload: { sessionIdleMinutes: 25 },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");

    const stored = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'session_idle_minutes'`)
      .get() as { value: string } | undefined;

    assert.notEqual(stored?.value, "25");
  });

  it("reports the env source on GET", async () => {
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "18";

    const response = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().sessionIdleSource, "env");
    assert.equal(response.json().sessionIdleMinutes, 18);
  });
});
