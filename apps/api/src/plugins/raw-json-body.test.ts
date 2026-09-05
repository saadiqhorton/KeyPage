import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import Fastify, { type FastifyInstance } from "fastify";

import { registerRawJsonBodyParser } from "./raw-json-body.js";

describe("registerRawJsonBodyParser", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  async function buildApp(): Promise<FastifyInstance> {
    app = Fastify({ logger: false });
    registerRawJsonBodyParser(app);
    app.post("/echo", async (request) => ({
      body: request.body ?? null,
      rawBody: request.rawBody ?? null,
    }));
    await app.ready();
    return app;
  }

  it("parses JSON and stores the exact raw body string", async () => {
    await buildApp();
    const payload = '{"hello":"world"}';
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      body: { hello: "world" },
      rawBody: payload,
    });
  });

  it("treats empty JSON bodies as undefined", async () => {
    await buildApp();
    const empty = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), { body: null, rawBody: "" });

    const whitespace = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "   ",
    });
    assert.equal(whitespace.statusCode, 200);
    assert.deepEqual(whitespace.json(), { body: null, rawBody: "   " });
  });

  it("rejects invalid JSON with a 400", async () => {
    await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{broken",
    });

    assert.equal(response.statusCode, 400);
  });
});
