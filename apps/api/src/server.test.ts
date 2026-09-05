import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import { APP_NAME } from "@keypage/shared";

import type { SetupGate } from "./auth/setup-token.js";
import { HttpRateLimited } from "./errors.js";
import { runMigrations } from "./db/migrations.js";
import { buildServer } from "./server.js";

function claimedGate(): SetupGate {
  return {
    token: null,
    filePath: "/tmp/test/setup-token",
    verify: () => false,
    consume: async () => {},
  };
}

describe("buildServer", () => {
  const tempDirs: string[] = [];
  const apps: Array<Awaited<ReturnType<typeof buildServer>>> = [];
  const dbs: Database.Database[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const db of dbs.splice(0)) {
      db.close();
    }
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keypage-server-"));
    tempDirs.push(dir);
    return dir;
  }

  async function start(options?: { webDir?: string; logLevel?: string }) {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    dbs.push(db);

    const dataDir = await makeTempDir();
    const app = await buildServer({
      dataDir,
      webDir: options?.webDir ?? path.join(dataDir, "missing-web"),
      logLevel: options?.logLevel ?? "silent",
      instance: { firstBootAt: "2026-01-01T00:00:00.000Z", schemaVersion: 1 },
      db,
      setupGate: claimedGate(),
    });
    apps.push(app);
    return { app, dataDir };
  }

  it("serves health and a plain-text fallback when the web UI is missing", async () => {
    const { app, dataDir } = await start();

    const health = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, "ok");
    assert.equal(health.json().app, APP_NAME);
    assert.equal(health.json().dataDir, dataDir);

    const missingApi = await app.inject({ method: "GET", url: "/api/nope" });
    assert.equal(missingApi.statusCode, 404);
    assert.deepEqual(missingApi.json(), { error: "Not Found" });

    const spa = await app.inject({ method: "GET", url: "/dashboard" });
    assert.equal(spa.statusCode, 200);
    assert.equal(spa.headers["content-type"], "text/plain");
    assert.equal(spa.body, "Web UI is not built yet.");
  });

  it("serves index.html for non-API routes when the web dir is built", async () => {
    const webDir = await makeTempDir();
    await fs.writeFile(path.join(webDir, "index.html"), "<html>KeyPage</html>", "utf8");
    const { app } = await start({ webDir });

    const spa = await app.inject({ method: "GET", url: "/dashboard" });
    assert.equal(spa.statusCode, 200);
    assert.match(spa.body, /KeyPage/);

    const missingApi = await app.inject({ method: "GET", url: "/api/missing" });
    assert.equal(missingApi.statusCode, 404);
  });

  it("falls back to plain text when web dir exists but index.html does not", async () => {
    const webDir = await makeTempDir();
    const { app } = await start({ webDir });

    const spa = await app.inject({ method: "GET", url: "/" });
    assert.equal(spa.statusCode, 200);
    assert.equal(spa.body, "Web UI is not built yet.");
  });

  it("maps HttpError retryAfterSeconds onto Retry-After", async () => {
    const { app } = await start();
    app.get("/limited", async () => {
      throw new HttpRateLimited("Too many attempts. Try again later.", 42);
    });

    const response = await app.inject({ method: "GET", url: "/limited" });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers["retry-after"], "42");
    assert.equal(response.json().error, "rate_limited");
    assert.equal(response.json().retryAfterSeconds, 42);
  });

  it("maps unknown errors to a 500 internal_error body", async () => {
    const { app } = await start();
    app.get("/boom", async () => {
      throw new Error("unexpected");
    });

    const response = await app.inject({ method: "GET", url: "/boom" });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      error: "internal_error",
      message: "Internal server error",
    });
  });

  it("maps Fastify validation errors to invalid_request", async () => {
    const { app } = await start();
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      headers: { "content-type": "application/json" },
      payload: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");
    assert.equal(response.json().message, "Invalid request body");
    assert.ok(Array.isArray(response.json().details));
    assert.ok(response.json().details.length > 0);
  });
});
