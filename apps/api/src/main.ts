import { config } from "./config.js";
import { ensureDataDir } from "./data-dir.js";
import { buildServer } from "./server.js";

async function main() {
  const instance = await ensureDataDir(config.dataDir);
  const app = await buildServer({
    dataDir: config.dataDir,
    webDir: config.webDir,
    logLevel: config.logLevel,
    instance,
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`listening on ${config.host}:${config.port}`);

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
