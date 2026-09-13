import fs from "node:fs/promises";
import path from "node:path";

import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { API_BASE, API_NOT_FOUND_ERROR } from "@keypage/shared";
import Fastify, { type FastifyError } from "fastify";
import type Database from "better-sqlite3";

import { config } from "./config.js";
import type { InstanceRecord } from "./data-dir.js";
import { HttpError, toApiErrorBody } from "./errors.js";
import type { SetupGate } from "./auth/setup-token.js";
import { registerRawJsonBodyParser } from "./plugins/raw-json-body.js";
import { healthRoutes } from "./routes/health.js";
import { keyEntryRoutes } from "./routes/key-entries.js";
import { settingsRoutes } from "./routes/settings.js";
import { vaultRoutes } from "./routes/vault.js";

type BuildServerOptions = {
  dataDir: string;
  webDir: string;
  logLevel: string;
  instance: InstanceRecord;
  db: Database.Database;
  setupGate: SetupGate;
  requireHttpsSetup?: boolean;
  allowInsecureLocalSetup?: boolean;
  trustedProxies?: string[];
  publicOrigin?: string;
};

/** Pino/Fastify paths that must never appear in request or application logs. */
export const LOGGER_REDACT_PATHS = [
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "req.headers.authorization",
  "setupToken",
  "req.body.setupToken",
  "body.setupToken",
  "req.body.authKeyB64",
  "body.authKeyB64",
] as const;

const CLIENT_SECRET_FIELDS = new Set([
  "masterPassword", "masterKey", "masterKeyB64", "derivedKey", "derivedKeyB64",
  "encryptionKey", "encryptionKeyB64", "authKey", "authKeyB64",
]);

function rejectClientSecrets(value: unknown, field = "body"): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CLIENT_SECRET_FIELDS.has(key)) {
      throw new HttpError(400, "invalid_request", "Client-only secret material is not accepted", {
        details: [{ field: `${field}.${key}`, message: "must never be sent to the server" }],
      });
    }
    rejectClientSecrets(child, `${field}.${key}`);
  }
}

async function webDirExists(webDir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(webDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function buildServer(options: BuildServerOptions) {
  const app = Fastify({
    logger: {
      level: options.logLevel,
      redact: [...LOGGER_REDACT_PATHS],
    },
    trustProxy: options.trustedProxies ?? config.trustedProxies,
  });

  await app.register(fastifyCookie);
  registerRawJsonBodyParser(app);
  app.addHook("preValidation", async (request) => rejectClientSecrets(request.body));
  app.addHook("onRequest", async (request, reply) => {
    const publicOrigin = options.publicOrigin ?? config.publicOrigin;
    if (!publicOrigin) return;
    const expected = new URL(publicOrigin);
    if (
      request.host !== expected.host ||
      request.protocol !== expected.protocol.slice(0, -1)
    ) {
      await reply.status(421).send({
        error: "invalid_request",
        message: "Misdirected request",
      });
    }
  });

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
    const body = toApiErrorBody(error);

    if (error instanceof HttpError && error.retryAfterSeconds !== undefined) {
      void reply.header("Retry-After", String(error.retryAfterSeconds));
    }

    return reply.status(statusCode).send(body);
  });

  await app.register(healthRoutes, {
    dataDir: options.dataDir,
    instance: options.instance,
  });

  await app.register(vaultRoutes, {
    prefix: `${API_BASE}/vault`,
    db: options.db,
    setupGate: options.setupGate,
    requireHttpsSetup: options.requireHttpsSetup ?? config.requireHttpsSetup,
    allowInsecureLocalSetup:
      options.allowInsecureLocalSetup ?? config.allowInsecureLocalSetup,
    publicOrigin: options.publicOrigin ?? config.publicOrigin,
  });

  await app.register(keyEntryRoutes, {
    prefix: `${API_BASE}/keys`,
    db: options.db,
  });

  await app.register(settingsRoutes, {
    prefix: `${API_BASE}/settings`,
    db: options.db,
  });

  const hasWebDir = await webDirExists(options.webDir);

  if (hasWebDir) {
    await app.register(fastifyStatic, {
      root: options.webDir,
      prefix: "/",
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith(`${API_BASE}/`)) {
      return reply.status(404).send({ error: API_NOT_FOUND_ERROR });
    }

    if (hasWebDir) {
      const indexPath = path.join(options.webDir, "index.html");

      try {
        await fs.access(indexPath);
        return reply.sendFile("index.html");
      } catch {
        // Fall through to the plain-text response below.
      }
    }

    return reply
      .status(200)
      .type("text/plain")
      .send("Web UI is not built yet.");
  });

  return app;
}
