import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";

import fastifyCookie from "@fastify/cookie";
import Database from "better-sqlite3";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import {
  AUTH_VERIFIER_PROOF_V1,
  createLoginClientProof,
  loginAuthMessage,
  loginStoredKeyHexFromAuthKey,
  recoveryStoredKeyHexFromMasterKey,
} from "@keypage/shared";

import { sha256Hex } from "../auth/tokens.js";
import { hashAuthKey } from "../auth/verifier.js";
import { initializeVault, replaceRecoveryCodes } from "../auth/vault-repo.js";
import { runMigrations } from "../db/migrations.js";
import { HttpError, toApiErrorBody } from "../errors.js";
import { vaultRoutes } from "./vault.js";

const AUTH_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const AUTH_KEY = new Uint8Array(Buffer.from(AUTH_KEY_B64, "base64"));
const MASTER_KEY = new Uint8Array(Buffer.alloc(32, 8));

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

function resetBody(ticket: string, challengeNonceB64: string) {
  return {
    recoveryTicket: ticket,
    challengeNonceB64,
    kdf: sampleKdf(),
    authStoredKeyHex: proofKeys().authStoredKeyHex,
    recoveryStoredKeyHex: proofKeys().recoveryStoredKeyHex,
    recoveryCodes: sampleRecoveryCodes(16),
    entries: [],
  };
}

async function buildTestApp(db: Database.Database): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
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

  await app.register(vaultRoutes, { prefix: "/api/vault", db });
  await app.ready();
  return app;
}

function insertLegacyVault(db: Database.Database, phc: string): void {
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO vault_auth (
       id, kdf_algorithm, kdf_memory_kib, kdf_iterations, kdf_parallelism,
       kdf_salt, auth_verifier, auth_stored_key, recovery_stored_key,
       key_version, created_at, updated_at
     ) VALUES (1, 'pbkdf2-sha256', NULL, 600000, NULL, ?, ?, NULL, NULL, 1, ?, ?)`,
  ).run(sampleKdf().saltB64, phc, nowIso, nowIso);
  replaceRecoveryCodes(db, sampleRecoveryCodes(), 1, nowIso);
}

describe("vault auth routes (SAA-177)", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let legacyPhc: string;

  before(async () => {
    legacyPhc = await hashAuthKey(AUTH_KEY_B64);
  });

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  async function startProofReady(): Promise<void> {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    initializeVault(db, {
      kdf: sampleKdf(),
      proofKeys: proofKeys(),
      recoveryCodes: sampleRecoveryCodes(),
    });
    app = await buildTestApp(db);
  }

  async function startLegacy(): Promise<void> {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    insertLegacyVault(db, legacyPhc);
    app = await buildTestApp(db);
  }

  it("reports proofReady from status", async () => {
    await startProofReady();
    const ready = await app.inject({ method: "GET", url: "/api/vault/status" });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().proofReady, true);

    await app.close();
    db.close();
    await startLegacy();
    const legacy = await app.inject({ method: "GET", url: "/api/vault/status" });
    assert.equal(legacy.statusCode, 200);
    assert.equal(legacy.json().proofReady, false);
  });

  it("issues a login challenge on a proof-ready vault and rejects replay", async () => {
    await startProofReady();

    const challenge = await app.inject({
      method: "POST",
      url: "/api/vault/login/challenge",
    });
    assert.equal(challenge.statusCode, 200);
    const issued = challenge.json() as {
      challengeId: string;
      nonceB64: string;
    };
    const clientProofB64 = Buffer.from(
      createLoginClientProof(
        AUTH_KEY,
        loginAuthMessage(issued.challengeId, issued.nonceB64),
      ),
    ).toString("base64");

    const login = await app.inject({
      method: "POST",
      url: "/api/vault/login",
      payload: {
        challengeId: issued.challengeId,
        nonceB64: issued.nonceB64,
        clientProofB64,
      },
    });
    assert.equal(login.statusCode, 200);

    const replay = await app.inject({
      method: "POST",
      url: "/api/vault/login",
      payload: {
        challengeId: issued.challengeId,
        nonceB64: issued.nonceB64,
        clientProofB64,
      },
    });
    assert.equal(replay.statusCode, 401);
    assert.equal(replay.json().error, "invalid_credentials");
  });

  it("rejects authKeyB64 login on a proof-ready vault", async () => {
    await startProofReady();
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/login",
      payload: { authKeyB64: AUTH_KEY_B64 },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");
    assert.match(response.json().message, /authKeyB64 is not accepted/);
  });

  it("enrolls a legacy vault via authKeyB64 then rejects a second authKey login", async () => {
    await startLegacy();

    const challengeBlocked = await app.inject({
      method: "POST",
      url: "/api/vault/login/challenge",
    });
    assert.equal(challengeBlocked.statusCode, 400);

    const enroll = await app.inject({
      method: "POST",
      url: "/api/vault/login",
      payload: { authKeyB64: AUTH_KEY_B64 },
    });
    assert.equal(enroll.statusCode, 200);

    const row = db
      .prepare(
        `SELECT auth_stored_key, auth_verifier, recovery_stored_key
         FROM vault_auth WHERE id = 1`,
      )
      .get() as {
        auth_stored_key: string;
        auth_verifier: string;
        recovery_stored_key: string | null;
      };
    assert.equal(row.auth_stored_key, proofKeys().authStoredKeyHex);
    assert.equal(row.auth_verifier, AUTH_VERIFIER_PROOF_V1);
    assert.equal(row.recovery_stored_key, null);

    const status = await app.inject({ method: "GET", url: "/api/vault/status" });
    assert.equal(status.json().proofReady, true);

    const second = await app.inject({
      method: "POST",
      url: "/api/vault/login",
      payload: { authKeyB64: AUTH_KEY_B64 },
    });
    assert.equal(second.statusCode, 400);
    assert.match(second.json().message, /authKeyB64 is not accepted/);
  });

  it("cancels an open recovery ticket and is a no-op for an unknown ticket", async () => {
    await startProofReady();

    const claim = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/claim",
      payload: { lookupHash: sampleRecoveryCodes()[0]!.lookupHash },
    });
    assert.equal(claim.statusCode, 200);
    const ticket = claim.json().recoveryTicket as string;

    const open = db
      .prepare(
        `SELECT COUNT(*) AS count FROM recovery_tickets
         WHERE consumed_at IS NULL`,
      )
      .get() as { count: number };
    assert.equal(open.count, 1);

    const cancel = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/cancel",
      payload: { recoveryTicket: ticket },
    });
    assert.equal(cancel.statusCode, 204);

    const after = db
      .prepare(
        `SELECT COUNT(*) AS count FROM recovery_tickets
         WHERE consumed_at IS NULL`,
      )
      .get() as { count: number };
    assert.equal(after.count, 0);

    const unknown = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/cancel",
      payload: { recoveryTicket: "not-a-ticket" },
    });
    assert.equal(unknown.statusCode, 204);
  });

  it("rejects a proof-ready recovery reset without challengeNonceB64", async () => {
    await startProofReady();
    const claim = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/claim",
      payload: { lookupHash: sampleRecoveryCodes()[0]!.lookupHash },
    });
    assert.equal(claim.statusCode, 200);

    const { recoveryTicket } = claim.json() as { recoveryTicket: string };
    const response = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/reset",
      payload: {
        recoveryTicket,
        kdf: sampleKdf(),
        authStoredKeyHex: proofKeys().authStoredKeyHex,
        recoveryStoredKeyHex: proofKeys().recoveryStoredKeyHex,
        recoveryCodes: sampleRecoveryCodes(16),
        entries: [],
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");
  });

  it("rejects a proof-ready recovery reset without recoveryClientProofB64", async () => {
    await startProofReady();
    const claim = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/claim",
      payload: { lookupHash: sampleRecoveryCodes()[0]!.lookupHash },
    });
    assert.equal(claim.statusCode, 200);

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/reset",
      payload: resetBody(
        claim.json().recoveryTicket,
        claim.json().challengeNonceB64,
      ),
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_request");
    assert.equal(
      response.json().details?.[0]?.message,
      "must have required property 'recoveryClientProofB64'",
    );
  });

  it("resets a pre-migration ticket with a null challenge_nonce and no proof", async () => {
    await startLegacy();
    const nowIso = new Date().toISOString();
    const ticketPlain = "pre-migration-ticket";
    const codeId = (
      db.prepare(`SELECT id FROM recovery_codes LIMIT 1`).get() as { id: string }
    ).id;
    db.prepare(
      `INSERT INTO recovery_tickets (
         id, token_hash, recovery_code_id, created_at, expires_at, consumed_at,
         challenge_nonce
       ) VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      "legacy-ticket-row",
      sha256Hex(ticketPlain),
      codeId,
      nowIso,
      new Date(Date.now() + 600_000).toISOString(),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/reset",
      payload: {
        recoveryTicket: ticketPlain,
        kdf: sampleKdf(),
        authStoredKeyHex: proofKeys().authStoredKeyHex,
        recoveryStoredKeyHex: proofKeys().recoveryStoredKeyHex,
        recoveryCodes: sampleRecoveryCodes(16),
        entries: [],
      },
    });
    assert.equal(response.statusCode, 200);

    const status = await app.inject({ method: "GET", url: "/api/vault/status" });
    assert.equal(status.json().proofReady, true);
  });

  it("resets a legacy vault without a masterKey proof and leaves it proof-ready", async () => {
    await startLegacy();
    const claim = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/claim",
      payload: { lookupHash: sampleRecoveryCodes()[0]!.lookupHash },
    });
    assert.equal(claim.statusCode, 200);

    const response = await app.inject({
      method: "POST",
      url: "/api/vault/recovery/reset",
      payload: resetBody(
        claim.json().recoveryTicket,
        claim.json().challengeNonceB64,
      ),
    });
    assert.equal(response.statusCode, 200);

    const row = db
      .prepare(
        `SELECT auth_stored_key, recovery_stored_key, auth_verifier
         FROM vault_auth WHERE id = 1`,
      )
      .get() as {
        auth_stored_key: string;
        recovery_stored_key: string;
        auth_verifier: string;
      };
    assert.equal(row.auth_stored_key, proofKeys().authStoredKeyHex);
    assert.equal(row.recovery_stored_key, proofKeys().recoveryStoredKeyHex);
    assert.equal(row.auth_verifier, AUTH_VERIFIER_PROOF_V1);

    const status = await app.inject({ method: "GET", url: "/api/vault/status" });
    assert.equal(status.json().proofReady, true);
  });
});
