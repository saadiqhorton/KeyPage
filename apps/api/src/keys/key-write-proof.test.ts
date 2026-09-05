import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import {
  base64Encode,
  createLoginClientProof,
  keyEntryWriteAuthMessage,
  loginStoredKeyHexFromAuthKey,
} from "@keypage/shared";

import { createLoginChallenge } from "../auth/login-challenges.js";
import { initializeVault } from "../auth/vault-repo.js";
import { runMigrations } from "../db/migrations.js";
import { HttpError, HttpUnauthenticated, toApiErrorBody } from "../errors.js";
import { registerRawJsonBodyParser } from "../plugins/raw-json-body.js";
import {
  KEY_WRITE_CHALLENGE_HEADER,
  KEY_WRITE_NONCE_HEADER,
  KEY_WRITE_PROOF_HEADER,
  requireKeyWriteProof,
} from "./key-write-proof.js";

const AUTH_KEY = new Uint8Array(32).fill(9);
const PATH = "/api/keys";

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

describe("requireKeyWriteProof", () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
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

    app = Fastify({ logger: false });
    registerRawJsonBodyParser(app);
    app.setErrorHandler((error: FastifyError, _request, reply) => {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      return reply.status(statusCode).send(toApiErrorBody(error));
    });
    app.post("/api/keys", async (request) => {
      requireKeyWriteProof(db, request, PATH);
      return { ok: true };
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it("rejects missing proof headers with a uniform 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: PATH,
      headers: { "content-type": "application/json" },
      payload: "{}",
    });

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), {
      error: "unauthenticated",
      message: "Invalid or expired key possession proof",
    });
  });

  it("rejects an unknown challenge", async () => {
    const response = await app.inject({
      method: "POST",
      url: PATH,
      headers: {
        "content-type": "application/json",
        [KEY_WRITE_CHALLENGE_HEADER]: "11111111-1111-4111-8111-111111111111",
        [KEY_WRITE_NONCE_HEADER]: Buffer.alloc(32, 1).toString("base64"),
        [KEY_WRITE_PROOF_HEADER]: Buffer.alloc(32, 2).toString("base64"),
      },
      payload: "{}",
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "unauthenticated");
  });

  it("rejects invalid proof base64", async () => {
    const issued = createLoginChallenge(db, "key-write");
    const response = await app.inject({
      method: "POST",
      url: PATH,
      headers: {
        "content-type": "application/json",
        [KEY_WRITE_CHALLENGE_HEADER]: issued.challengeId,
        [KEY_WRITE_NONCE_HEADER]: issued.nonceB64,
        [KEY_WRITE_PROOF_HEADER]: "!!!not-base64!!!",
      },
      payload: "{}",
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "unauthenticated");
  });

  it("rejects a proof that does not match the raw body", async () => {
    const issued = createLoginChallenge(db, "key-write");
    const message = keyEntryWriteAuthMessage({
      challengeId: issued.challengeId,
      nonceB64: issued.nonceB64,
      method: "POST",
      path: PATH,
      bodyJson: '{"other":true}',
    });
    const proofB64 = base64Encode(createLoginClientProof(AUTH_KEY, message));

    const response = await app.inject({
      method: "POST",
      url: PATH,
      headers: {
        "content-type": "application/json",
        [KEY_WRITE_CHALLENGE_HEADER]: issued.challengeId,
        [KEY_WRITE_NONCE_HEADER]: issued.nonceB64,
        [KEY_WRITE_PROOF_HEADER]: proofB64,
      },
      payload: '{"hello":true}',
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "unauthenticated");
  });

  it("accepts a proof computed over the exact raw JSON body", async () => {
    const issued = createLoginChallenge(db, "key-write");
    const payload = '{"hello":true}';
    const message = keyEntryWriteAuthMessage({
      challengeId: issued.challengeId,
      nonceB64: issued.nonceB64,
      method: "POST",
      path: PATH,
      bodyJson: payload,
    });
    const proofB64 = base64Encode(createLoginClientProof(AUTH_KEY, message));

    const response = await app.inject({
      method: "POST",
      url: PATH,
      headers: {
        "content-type": "application/json",
        [KEY_WRITE_CHALLENGE_HEADER]: issued.challengeId,
        [KEY_WRITE_NONCE_HEADER]: issued.nonceB64,
        [KEY_WRITE_PROOF_HEADER]: proofB64,
      },
      payload,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  });

  it("throws when rawBody is missing", () => {
    const issued = createLoginChallenge(db, "key-write");
    const request = {
      method: "POST",
      headers: {
        [KEY_WRITE_CHALLENGE_HEADER]: issued.challengeId,
        [KEY_WRITE_NONCE_HEADER]: issued.nonceB64,
        [KEY_WRITE_PROOF_HEADER]: Buffer.alloc(32, 1).toString("base64"),
      },
    } as Parameters<typeof requireKeyWriteProof>[1];

    assert.throws(
      () => requireKeyWriteProof(db, request, PATH),
      (error: unknown) =>
        error instanceof HttpUnauthenticated &&
        error.message === "Invalid or expired key possession proof",
    );
  });
});
