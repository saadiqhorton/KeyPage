import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Fastify, { type FastifyInstance } from "fastify";

import { APP_NAME, APP_VERSION } from "@keypage/shared";

import { healthRoutes } from "./health.js";

const FIRST_BOOT_AT = "2026-01-01T00:00:00.000Z";
const DATA_DIR = "/tmp/keypage-test";

describe("GET /api/health", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(healthRoutes, {
      dataDir: DATA_DIR,
      instance: { firstBootAt: FIRST_BOOT_AT, schemaVersion: 1 },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("returns health metadata without service catalog size", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ok",
      app: APP_NAME,
      version: APP_VERSION,
      dataDir: DATA_DIR,
      firstBootAt: FIRST_BOOT_AT,
    });
    assert.equal("serviceCatalogSize" in response.json(), false);
  });
});
