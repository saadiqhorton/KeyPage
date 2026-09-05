import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import Fastify, { type FastifyInstance } from "fastify";

import { config } from "../config.js";
import { checkOrigin, requestHostForOriginCheck } from "./check-origin.js";

describe("checkOrigin", () => {
  let app: FastifyInstance;
  const originalTrustProxy = config.trustProxy;

  afterEach(async () => {
    (config as { trustProxy: boolean }).trustProxy = originalTrustProxy;
    await app?.close();
  });

  async function buildApp(): Promise<FastifyInstance> {
    app = Fastify({ logger: false });
    app.addHook("preHandler", checkOrigin);
    app.get("/ok", async () => ({ ok: true }));
    await app.ready();
    return app;
  }

  it("allows requests with no Origin header", async () => {
    await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ok",
      headers: { host: "localhost:9090" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  });

  it("allows an Origin that matches Host", async () => {
    await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ok",
      headers: {
        host: "localhost:9090",
        origin: "http://localhost:9090",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });
  });

  it("rejects a cross-origin Origin", async () => {
    await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ok",
      headers: {
        host: "localhost:9090",
        origin: "http://evil.example",
      },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), {
      error: "invalid_request",
      message: "Forbidden",
    });
  });

  it("rejects a malformed Origin URL", async () => {
    await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ok",
      headers: {
        host: "localhost:9090",
        origin: "not a url",
      },
    });

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), {
      error: "invalid_request",
      message: "Forbidden",
    });
  });

  it("skips the host comparison when Host is missing", async () => {
    await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/ok",
      headers: { origin: "http://localhost:9090" },
    });

    assert.equal(response.statusCode, 200);
  });

  it("uses the first X-Forwarded-Host value when trustProxy is on", async () => {
    (config as { trustProxy: boolean }).trustProxy = true;
    await buildApp();

    const allowed = await app.inject({
      method: "GET",
      url: "/ok",
      headers: {
        host: "localhost:9090",
        "x-forwarded-host": "app.example, other.example",
        origin: "https://app.example",
      },
    });
    assert.equal(allowed.statusCode, 200);

    const blocked = await app.inject({
      method: "GET",
      url: "/ok",
      headers: {
        host: "localhost:9090",
        "x-forwarded-host": "app.example",
        origin: "https://evil.example",
      },
    });
    assert.equal(blocked.statusCode, 403);
  });

  it("requestHostForOriginCheck falls back to Host when trustProxy is off", () => {
    (config as { trustProxy: boolean }).trustProxy = false;
    const host = requestHostForOriginCheck({
      headers: {
        host: "localhost:9090",
        "x-forwarded-host": "ignored.example",
      },
    } as Parameters<typeof requestHostForOriginCheck>[0]);

    assert.equal(host, "localhost:9090");
  });

  it("requestHostForOriginCheck ignores empty forwarded hosts", () => {
    (config as { trustProxy: boolean }).trustProxy = true;
    const host = requestHostForOriginCheck({
      headers: {
        host: "localhost:9090",
        "x-forwarded-host": "",
      },
    } as Parameters<typeof requestHostForOriginCheck>[0]);

    assert.equal(host, "localhost:9090");
  });
});
