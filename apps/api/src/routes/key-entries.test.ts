import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import fastifyCookie from "@fastify/cookie";
import Database from "better-sqlite3";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";

import { SESSION_COOKIE_NAME } from "@keypage/shared";

import { createSession } from "../auth/sessions.js";
import { initializeVault } from "../auth/vault-repo.js";
import { hashAuthKey } from "../auth/verifier.js";
import { runMigrations } from "../db/migrations.js";
import { HttpError, toApiErrorBody } from "../errors.js";
import { keyEntryRoutes } from "./key-entries.js";

const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ENTRY_ID = "22222222-2222-4222-8222-222222222222";

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

function cipher(keyVersion: number, fill = 4) {
  return {
    algorithm: "aes-256-gcm" as const,
    ivB64: Buffer.alloc(12, fill).toString("base64"),
    ciphertextB64: Buffer.alloc(17, fill).toString("base64"),
    keyVersion,
  };
}

function createBody(id: string, keyVersion: number, fill = 4) {
  return {
    id,
    label: "Test",
    serviceId: "openai",
    tags: [],
    cipher: cipher(keyVersion, fill),
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
      });
    }
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return reply.status(statusCode).send(toApiErrorBody(error));
  });

  await app.register(keyEntryRoutes, { prefix: "/api/keys", db });
  await app.ready();

  return app;
}

/**
 * Rotation stand-in. The behaviour under test is what the server does with a
 * client that still declares the previous key version, so these tests move the
 * vault forward directly and leave the session alive on purpose: that is the
 * shared-cookie case a revoke-only defence cannot see.
 */
function bumpVaultKeyVersion(db: Database.Database): void {
  db.prepare(
    `UPDATE vault_auth SET key_version = key_version + 1 WHERE id = 1`,
  ).run();
}

function readRow(
  db: Database.Database,
  id: string,
): { key_version: number; cipher_iv: string } | undefined {
  return db
    .prepare(`SELECT key_version, cipher_iv FROM key_entries WHERE id = ?`)
    .get(id) as { key_version: number; cipher_iv: string } | undefined;
}

describe("Key Entry writes across a key reset", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    initializeVault(db, {
      kdf: sampleKdf(),
      authVerifier: await hashAuthKey(Buffer.alloc(32, 9).toString("base64")),
      recoveryCodes: sampleRecoveryCodes(),
    });
    app = await buildTestApp(db);
    const { token } = createSession(db, {}, 1200);
    cookie = `${SESSION_COOKIE_NAME}=${token}`;
  });

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it("accepts a create that declares the current key version", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(readRow(db, ENTRY_ID)?.key_version, 1);
  });

  it("rejects a create that declares a superseded key version", async () => {
    bumpVaultKeyVersion(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "key_version_mismatch");
    assert.equal(readRow(db, ENTRY_ID), undefined);
  });

  it("rejects a create that declares a key version ahead of the vault", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 2),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "key_version_mismatch");
    assert.equal(readRow(db, ENTRY_ID), undefined);
  });

  it("rejects a create whose cipher omits the key version", async () => {
    const body = createBody(ENTRY_ID, 1) as {
      cipher: { keyVersion?: number };
    };
    delete body.cipher.keyVersion;

    const response = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: body,
    });

    assert.equal(response.statusCode, 400);
    assert.equal(readRow(db, ENTRY_ID), undefined);
  });

  it("rejects a cipher replacement that declares a superseded key version", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1),
    });
    assert.equal(created.statusCode, 201);
    const originalIv = readRow(db, ENTRY_ID)!.cipher_iv;

    bumpVaultKeyVersion(db);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/keys/${ENTRY_ID}`,
      headers: { cookie },
      payload: {
        keyVersion: 1,
        label: "Renamed",
        serviceId: "openai",
        tags: [],
        cipher: cipher(1, 7),
      },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "key_version_mismatch");

    const row = readRow(db, ENTRY_ID)!;
    assert.equal(row.cipher_iv, originalIv);
    assert.equal(row.key_version, 1);
  });

  it("allows a metadata-only update after a rotation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1),
    });
    assert.equal(created.statusCode, 201);

    bumpVaultKeyVersion(db);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/keys/${ENTRY_ID}`,
      headers: { cookie },
      payload: {
        keyVersion: 2,
        label: "Renamed",
        serviceId: "openai",
        tags: [],
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(readRow(db, ENTRY_ID)?.key_version, 1);
  });

  it("rejects a metadata-only update with a superseded key version", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1),
    });
    assert.equal(created.statusCode, 201);

    bumpVaultKeyVersion(db);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/keys/${ENTRY_ID}`,
      headers: { cookie },
      payload: {
        keyVersion: 1,
        label: "Renamed",
        serviceId: "openai",
        tags: [],
      },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "key_version_mismatch");
  });

  it("rejects delete with a superseded key version", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1),
    });
    assert.equal(created.statusCode, 201);

    bumpVaultKeyVersion(db);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/keys/${ENTRY_ID}`,
      headers: { cookie },
      payload: { keyVersion: 1 },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "key_version_mismatch");
    assert.ok(readRow(db, ENTRY_ID));
  });

  it("imports nothing when any entry declares a superseded key version", async () => {
    bumpVaultKeyVersion(db);

    const response = await app.inject({
      method: "POST",
      url: "/api/keys/import",
      headers: { cookie },
      payload: {
        entries: [
          createBody(ENTRY_ID, 2, 4),
          createBody(OTHER_ENTRY_ID, 1, 5),
        ],
      },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "key_version_mismatch");

    // The whole import shares one transaction, so the valid first entry must
    // roll back with the rejected second one.
    assert.equal(readRow(db, ENTRY_ID), undefined);
    assert.equal(readRow(db, OTHER_ENTRY_ID), undefined);
  });

  it("rejects a write from a session revoked by a rotation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1),
    });
    assert.equal(created.statusCode, 201);

    db.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL`,
    ).run(new Date().toISOString());

    const response = await app.inject({
      method: "DELETE",
      url: `/api/keys/${ENTRY_ID}`,
      headers: { cookie },
      payload: { keyVersion: 1 },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "session_expired");
    assert.ok(readRow(db, ENTRY_ID));
  });
});

describe("Key Entry import merge-by-id", () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let cookie: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    initializeVault(db, {
      kdf: sampleKdf(),
      authVerifier: await hashAuthKey(Buffer.alloc(32, 9).toString("base64")),
      recoveryCodes: sampleRecoveryCodes(),
    });
    app = await buildTestApp(db);
    const { token } = createSession(db, {}, 1200);
    cookie = `${SESSION_COOKIE_NAME}=${token}`;
  });

  afterEach(async () => {
    await app?.close();
    db?.close();
  });

  it("skips existing ids, preserves originals, and dedupes duplicate ids in one payload", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { cookie },
      payload: createBody(ENTRY_ID, 1, 4),
    });
    assert.equal(created.statusCode, 201);

    const originalRow = db
      .prepare(
        `SELECT label, cipher_iv, cipher_text FROM key_entries WHERE id = ?`,
      )
      .get(ENTRY_ID) as {
      label: string;
      cipher_iv: string;
      cipher_text: string;
    };

    const firstImport = await app.inject({
      method: "POST",
      url: "/api/keys/import",
      headers: { cookie },
      payload: {
        entries: [
          {
            ...createBody(ENTRY_ID, 1, 9),
            label: "Should not overwrite A",
          },
          createBody(OTHER_ENTRY_ID, 1, 5),
        ],
      },
    });

    assert.equal(firstImport.statusCode, 200);
    assert.deepEqual(firstImport.json(), {
      imported: 1,
      skippedIds: [ENTRY_ID],
    });

    const secondImport = await app.inject({
      method: "POST",
      url: "/api/keys/import",
      headers: { cookie },
      payload: {
        entries: [
          createBody(ENTRY_ID, 1, 6),
          createBody(OTHER_ENTRY_ID, 1, 7),
        ],
      },
    });

    assert.equal(secondImport.statusCode, 200);
    assert.deepEqual(secondImport.json(), {
      imported: 0,
      skippedIds: [ENTRY_ID, OTHER_ENTRY_ID],
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/keys",
      headers: { cookie },
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().entries.length, 2);

    const preserved = db
      .prepare(
        `SELECT label, cipher_iv, cipher_text FROM key_entries WHERE id = ?`,
      )
      .get(ENTRY_ID) as {
      label: string;
      cipher_iv: string;
      cipher_text: string;
    };
    assert.deepEqual(preserved, originalRow);

    const duplicatePayload = createBody(OTHER_ENTRY_ID, 1, 8);
    const duplicateImport = await app.inject({
      method: "POST",
      url: "/api/keys/import",
      headers: { cookie },
      payload: {
        entries: [duplicatePayload, duplicatePayload],
      },
    });

    assert.equal(duplicateImport.statusCode, 200);
    assert.deepEqual(duplicateImport.json(), {
      imported: 0,
      skippedIds: [OTHER_ENTRY_ID, OTHER_ENTRY_ID],
    });
    assert.equal(
      (
        db
          .prepare(`SELECT COUNT(*) AS count FROM key_entries`)
          .get() as { count: number }
      ).count,
      2,
    );
  });
});
