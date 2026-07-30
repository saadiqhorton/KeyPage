import fs from "node:fs/promises";
import path from "node:path";

import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError } from "fastify";
import type Database from "better-sqlite3";

import { config } from "./config.js";
import type { InstanceRecord } from "./data-dir.js";
import { HttpError, toApiErrorBody } from "./errors.js";
import { healthRoutes } from "./routes/health.js";
import { vaultRoutes } from "./routes/vault.js";

type BuildServerOptions = {
  dataDir: string;
  webDir: string;
  logLevel: string;
  instance: InstanceRecord;
  db: Database.Database;
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
    prefix: "/api/vault",
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
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({ error: "Not Found" });
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
