import fs from "node:fs/promises";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import {
  APP_NAME,
  APP_VERSION,
  SERVICE_CATALOG,
  type HealthResponse,
} from "@keypage/shared";
import Fastify from "fastify";
import type { InstanceRecord } from "./data-dir.js";

type BuildServerOptions = {
  dataDir: string;
  webDir: string;
  logLevel: string;
  instance: InstanceRecord;
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
    logger: { level: options.logLevel },
  });

  app.get("/api/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    app: APP_NAME,
    version: APP_VERSION,
    dataDir: options.dataDir,
    firstBootAt: options.instance.firstBootAt,
    serviceCatalogSize: SERVICE_CATALOG.length,
  }));

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
