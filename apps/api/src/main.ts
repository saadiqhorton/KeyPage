import { config } from "./config.js";
import { ensureDataDir } from "./data-dir.js";
import { closeDatabase, openDatabase } from "./db/index.js";
import { runHousekeeping } from "./db/housekeeping.js";
import { buildServer } from "./server.js";
import { resolveIdleTimeoutSeconds } from "./settings.js";

async function main() {
  const instance = await ensureDataDir(config.dataDir);
  const db = openDatabase(config.dataDir);
  runHousekeeping(db);

  const idleMinutes = resolveIdleTimeoutSeconds(db) / 60;
  if (idleMinutes < 15 || idleMinutes > 30) {
    console.warn(
      `Session idle timeout ${idleMinutes} minutes is outside the recommended 15-30 minute band`,
    );
  }

  const app = await buildServer({
    dataDir: config.dataDir,
    webDir: config.webDir,
    logLevel: config.logLevel,
    instance,
    db,
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`listening on ${config.host}:${config.port}`);

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    closeDatabase(db);
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
