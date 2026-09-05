import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import { SESSION_COOKIE_NAME } from "@keypage/shared";

import { clearSessionCookie, setSessionCookie } from "./cookies.js";

describe("session cookies", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  async function buildApp(trustProxy = false): Promise<FastifyInstance> {
    app = Fastify({ logger: false, trustProxy });
    await app.register(fastifyCookie);

    app.get("/set", async (request, reply) => {
      setSessionCookie(reply, request, "session-token");
      return { ok: true };
    });

    app.get("/clear", async (request, reply) => {
      clearSessionCookie(reply, request);
      return { ok: true };
    });

    await app.ready();
    return app;
  }

  function cookieHeader(response: { headers: Record<string, unknown> }): string {
    const raw = response.headers["set-cookie"];
    if (typeof raw === "string") {
      return raw;
    }
    assert.ok(Array.isArray(raw), "expected Set-Cookie header");
    return raw.join("; ");
  }

  it("sets an httpOnly lax session cookie without Secure on http", async () => {
    await buildApp();
    const response = await app.inject({ method: "GET", url: "/set" });

    assert.equal(response.statusCode, 200);
    const cookie = cookieHeader(response);
    assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=session-token`));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//i);
    assert.doesNotMatch(cookie, /Secure/i);
  });

  it("sets Secure when the request is https via a trusted proxy", async () => {
    await buildApp(true);
    const response = await app.inject({
      method: "GET",
      url: "/set",
      headers: { "x-forwarded-proto": "https" },
    });

    assert.equal(response.statusCode, 200);
    assert.match(cookieHeader(response), /Secure/i);
  });

  it("clears the session cookie with the same path and SameSite", async () => {
    await buildApp();
    const response = await app.inject({ method: "GET", url: "/clear" });

    assert.equal(response.statusCode, 200);
    const cookie = cookieHeader(response);
    assert.match(cookie, new RegExp(`${SESSION_COOKIE_NAME}=`));
    assert.match(cookie, /Path=\//i);
    assert.match(cookie, /SameSite=Lax/i);
  });
});
