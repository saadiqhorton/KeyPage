import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import fastifyCookie from "@fastify/cookie";
import Database from "better-sqlite3";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import {
  loginStoredKeyHexFromAuthKey,
  recoveryStoredKeyHexFromMasterKey,
} from "@keypage/shared";

import type { SetupGate } from "../auth/setup-token.js";
import { isVaultInitialized } from "../auth/vault-repo.js";
import { runMigrations } from "../db/migrations.js";
import { HttpError, toApiErrorBody } from "../errors.js";
import { vaultRoutes } from "./vault.js";

const AUTH_KEY = new Uint8Array(Buffer.alloc(32, 7));
const MASTER_KEY = new Uint8Array(Buffer.alloc(32, 8));
const SETUP_TOKEN = Buffer.alloc(32, 1).toString("base64url");
const WRONG_TOKEN = Buffer.alloc(32, 2).toString("base64url");

function sampleKdf() {
  return {
    algorithm: "pbkdf2-sha256" as const,
    saltB64: Buffer.alloc(16, 1).toString("base64"),
    iterations: 600_000,
  };
}

function sampleRecoveryCodes(seed = 0) {
  return Array.from({ length: 10 }, (_, index) => ({
    label: `code-${index + 1}`,
    lookupHash: `${(index + seed).toString(16).padStart(2, "0")}${"0".repeat(62)}`,
    kdf: sampleKdf(),
    wrappedMasterKeyB64: Buffer.alloc(60, 2).toString("base64"),
  }));
}

function proofKeys() {
  return {
    authStoredKeyHex: loginStoredKeyHexFromAuthKey(AUTH_KEY),
    recoveryStoredKeyHex: recoveryStoredKeyHexFromMasterKey(MASTER_KEY),
  };
}

function setupBody(setupToken: string) {
  return {
    setupToken,
    kdf: sampleKdf(),
    authStoredKeyHex: proofKeys().authStoredKeyHex,
    recoveryStoredKeyHex: proofKeys().recoveryStoredKeyHex,
    recoveryCodes: sampleRecoveryCodes(),
  };
}

function createSetupGate(token: string): { gate: SetupGate; consumed: () => boolean } {
  let currentToken: string | null = token;
  let wasConsumed = false;

  return {
    gate: {
      get token() {
        return currentToken;
      },
      filePath: "/tmp/test/setup-token",
      verify(candidate: string) {
        return currentToken !== null && candidate === currentToken;
      },
      consume: async () => {
        currentToken = null;
        wasConsumed = true;
      },
    },
    consumed: () => wasConsumed,
  };
}

async function buildTestApp(
  db: Database.Database,
  setupGate: SetupGate,
  options: { requireHttpsSetup?: boolean; trustProxy?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: options.trustProxy ?? false,
  });
  await app.register(fastifyCookie);

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.status(400).send({
        error: "invalid_request",
        message: "Invalid request body",
        details: error.validation.map((issue) => ({
          field: issue.instancePath || "body",
          message: issue.message ?? "invalid",
        })),
      });
    }
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return reply.status(statusCode).send(toApiErrorBody(error));
  });

  await app.register(vaultRoutes, {
    prefix: "/api/vault",
    db,
    setupGate,
    requireHttpsSetup: options.requireHttpsSetup ?? false,
  });
  await app.ready();
  return app;
}

describe("vault setup route (SAA-174)", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let gateBundle: ReturnType<typeof createSetupGate>;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    gateBundle = createSetupGate(SETUP_TOKEN);
    app = await buildTestApp(db, gateBundle.gate);
  });

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it("rejects a body with no setupToken as invalid_request", async () => {
    const { setupToken: _omit, ...body } = setupBody(SETUP_TOKEN);
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: body,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");
  });

  it("rejects a well-formed wrong token without initializing the vault", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(WRONG_TOKEN),
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "invalid_setup_token");
    assert.equal(isVaultInitialized(db), false);
    assert.equal(gateBundle.consumed(), false);

    const status = await app.inject({
      method: "GET",
      url: "/api/vault/status",
    });
    assert.equal(status.json().state, "setup_required");
  });

  it("accepts the correct token, consumes it, and rejects a follow-up claim", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(first.statusCode, 201);
    assert.equal(gateBundle.consumed(), true);
    assert.equal(isVaultInitialized(db), true);

    const second = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(second.statusCode, 409);
    assert.equal(second.json().error, "vault_already_initialized");
  });
});

describe("vault setup HTTPS guard (SAA-223)", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let gateBundle: ReturnType<typeof createSetupGate>;

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  async function start(options: {
    requireHttpsSetup?: boolean;
    trustProxy?: boolean;
  }) {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    gateBundle = createSetupGate(SETUP_TOKEN);
    app = await buildTestApp(db, gateBundle.gate, options);
  }

  it("keeps HTTP setup working when the opt-in flag is off", async () => {
    await start({ requireHttpsSetup: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(isVaultInitialized(db), true);
    assert.equal(gateBundle.consumed(), true);
  });

  it("rejects clear HTTP setup when the opt-in flag is on", async () => {
    await start({ requireHttpsSetup: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "https_required");
    assert.equal(isVaultInitialized(db), false);
    assert.equal(gateBundle.consumed(), false);
  });

  it("does not verify the setup token when rejecting clear HTTP", async () => {
    await start({ requireHttpsSetup: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      payload: setupBody(WRONG_TOKEN),
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "https_required");
    assert.equal(isVaultInitialized(db), false);
    assert.equal(gateBundle.consumed(), false);
  });

  it("ignores a spoofed X-Forwarded-Proto header unless trust proxy is on", async () => {
    await start({ requireHttpsSetup: true, trustProxy: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      headers: { "x-forwarded-proto": "https" },
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "https_required");
    assert.equal(isVaultInitialized(db), false);
  });

  it("accepts setup over X-Forwarded-Proto https when trust proxy is on", async () => {
    await start({ requireHttpsSetup: true, trustProxy: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      headers: { "x-forwarded-proto": "https" },
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(isVaultInitialized(db), true);
    assert.equal(gateBundle.consumed(), true);
  });

  it("rejects X-Forwarded-Proto http even when trust proxy is on", async () => {
    await start({ requireHttpsSetup: true, trustProxy: true });

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/setup",
      headers: { "x-forwarded-proto": "http" },
      payload: setupBody(SETUP_TOKEN),
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "https_required");
    assert.equal(isVaultInitialized(db), false);
    assert.equal(gateBundle.consumed(), false);
  });
});
