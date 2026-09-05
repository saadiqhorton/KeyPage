import { config } from "./config.js";
import { openSetupGate } from "./auth/setup-token.js";
import { isVaultInitialized } from "./auth/vault-repo.js";
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

  const setupGate = await openSetupGate({
    dataDir: config.dataDir,
    vaultInitialized: isVaultInitialized(db),
  });

  const app = await buildServer({
    dataDir: config.dataDir,
    webDir: config.webDir,
    logLevel: config.logLevel,
    instance,
    db,
    setupGate,
  });

  if (setupGate.token) {
    console.log(`────────────────────────────────────────────────────────────────
  KeyPage first-boot setup token

    ${setupGate.token}

  Paste it on the setup screen to claim this vault.
  Also readable at: ${setupGate.filePath}
  Anyone who can reach this server but cannot read this token
  cannot claim the vault.
────────────────────────────────────────────────────────────────`);
  }

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

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
