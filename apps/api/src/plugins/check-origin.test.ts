import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { createCheckOrigin } from "./check-origin.js";

describe("checkOrigin", () => {
  let app: FastifyInstance;
  afterEach(async () => app?.close());

  async function build(publicOrigin?: string) {
    app = Fastify({ logger: false });
    app.addHook("preHandler", createCheckOrigin(publicOrigin));
    app.post("/write", async () => ({ ok: true }));
    await app.ready();
  }

  it("rejects a missing Origin when a canonical public origin is configured", async () => {
    await build("https://keys.example.com");
    const response = await app.inject({ method: "POST", url: "/write" });
    assert.equal(response.statusCode, 403);
  });

  it("requires an exact scheme, host, and port match", async () => {
    await build("https://keys.example.com");
    const allowed = await app.inject({
      method: "POST", url: "/write", headers: { origin: "https://keys.example.com" },
    });
    assert.equal(allowed.statusCode, 200);
    for (const origin of ["http://keys.example.com", "https://evil.example"]) {
      const blocked = await app.inject({ method: "POST", url: "/write", headers: { origin } });
      assert.equal(blocked.statusCode, 403);
    }
  });

  it("derives same-origin checks from the trusted request authority in direct mode", async () => {
    await build();
    const response = await app.inject({
      method: "POST", url: "/write", headers: { host: "localhost:9090", origin: "http://localhost:9090" },
    });
    assert.equal(response.statusCode, 200);
  });
});
