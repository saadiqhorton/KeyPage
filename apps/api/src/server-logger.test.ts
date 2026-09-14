import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { afterEach, describe, it } from "node:test";

import Fastify from "fastify";
import Database from "better-sqlite3";

import {
  loginStoredKeyHexFromAuthKey,
  recoveryStoredKeyHexFromMasterKey,
} from "@keypage/shared";

import type { SetupGate } from "./auth/setup-token.js";
import { isVaultInitialized } from "./auth/vault-repo.js";
import { runMigrations } from "./db/migrations.js";
import { LOGGER_REDACT_PATHS, buildServer } from "./server.js";

const AUTH_KEY = new Uint8Array(Buffer.alloc(32, 7));
const MASTER_KEY = new Uint8Array(Buffer.alloc(32, 8));
/** Distinctive 43-char token so a leak is obvious in captured log lines. */
const SETUP_TOKEN = Buffer.alloc(32, 0xa5).toString("base64url");
const WRONG_TOKEN = Buffer.alloc(32, 0x5a).toString("base64url");

function sampleKdf() {
  return {
    algorithm: "pbkdf2-sha256" as const,
    saltB64: Buffer.alloc(16, 1).toString("base64"),
    iterations: 600_000,
  };
}

function setupBody(setupToken: string) {
  return {
    setupToken,
    kdf: sampleKdf(),
    authStoredKeyHex: loginStoredKeyHexFromAuthKey(AUTH_KEY),
    recoveryStoredKeyHex: recoveryStoredKeyHexFromMasterKey(MASTER_KEY),
    recoveryCodes: Array.from({ length: 10 }, (_, index) => ({
      label: `code-${index + 1}`,
      lookupHash: `${index.toString(16).padStart(2, "0")}${"0".repeat(62)}`,
      kdf: sampleKdf(),
      wrappedMasterKeyB64: Buffer.alloc(60, 2).toString("base64"),
    })),
  };
}

function createSetupGate(token: string): SetupGate {
  let currentToken: string | null = token;
  return {
    get token() {
      return currentToken;
    },
    filePath: "/tmp/test/setup-token",
    verify(candidate: string) {
      return currentToken !== null && candidate === currentToken;
    },
    consume: async () => {
      currentToken = null;
    },
  };
}

function createLogCapture(): { stream: Writable; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      callback();
    },
  });
  return {
    stream,
    output: () => chunks.join(""),
  };
}

async function startVault(setupToken: string) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  const app = await buildServer({
    dataDir: "/tmp/keypage-logger-redact",
    webDir: "/tmp/keypage-logger-redact-missing-web",
    logLevel: "silent",
    instance: { firstBootAt: "2026-01-01T00:00:00.000Z", schemaVersion: 1 },
    db,
    setupGate: createSetupGate(setupToken),
    requireHttpsSetup: false,
  });
  return { app, db };
}

describe("Fastify logger redact (SAA-222)", () => {
  const apps: Array<Awaited<ReturnType<typeof buildServer>>> = [];
  const dbs: Database.Database[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const db of dbs.splice(0)) {
      db.close();
    }
  });

  it("lists setupToken on the production redact paths", () => {
    assert.ok(
      (LOGGER_REDACT_PATHS as readonly string[]).includes("req.body.setupToken"),
      "req.body.setupToken must be redacted",
    );
    assert.ok(
      (LOGGER_REDACT_PATHS as readonly string[]).includes("setupToken"),
      "top-level setupToken must be redacted",
    );
    assert.ok(
      (LOGGER_REDACT_PATHS as readonly string[]).includes("body.setupToken"),
      "body.setupToken must be redacted",
    );
  });

  it("redacts setupToken when a logger path includes body fields", async () => {
    const capture = createLogCapture();
    const app = Fastify({
      logger: {
        level: "info",
        stream: capture.stream,
        redact: [...LOGGER_REDACT_PATHS],
      },
    });

    app.log.info({
      req: { body: { setupToken: SETUP_TOKEN } },
      body: { setupToken: SETUP_TOKEN },
      setupToken: SETUP_TOKEN,
    });

    const logged = capture.output();
    assert.equal(
      logged.includes(SETUP_TOKEN),
      false,
      "plaintext setup token must not appear in logger output",
    );
    assert.match(logged, /\[Redacted\]/);
    await app.close();
  });

  it("accepts the correct token and initializes the vault", async () => {
    const { app, db } = await startVault(SETUP_TOKEN);
    apps.push(app);
    dbs.push(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(isVaultInitialized(db), true);
  });

  it("rejects a wrong setup token without initializing the vault", async () => {
    const { app, db } = await startVault(SETUP_TOKEN);
    apps.push(app);
    dbs.push(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(WRONG_TOKEN),
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "invalid_setup_token");
    assert.equal(isVaultInitialized(db), false);
  });

  it("rejects a missing setupToken as invalid_request", async () => {
    const { app, db } = await startVault(SETUP_TOKEN);
    apps.push(app);
    dbs.push(db);

    const { setupToken: _omit, ...body } = setupBody(SETUP_TOKEN);
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: body,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");
    assert.equal(isVaultInitialized(db), false);
  });
});
