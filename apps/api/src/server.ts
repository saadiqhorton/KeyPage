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
};

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
      redact: [
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "req.headers.authorization",
      ],
    },
    trustProxy: config.trustProxy,
  });

  await app.register(fastifyCookie);
  registerRawJsonBodyParser(app);

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
