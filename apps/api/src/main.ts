import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "./config.js";
import { openSetupGate } from "./auth/setup-token.js";
import { isVaultInitialized } from "./auth/vault-repo.js";
import { ensureDataDir } from "./data-dir.js";
import { closeDatabase, openDatabase } from "./db/index.js";
import { runHousekeeping } from "./db/housekeeping.js";
import { buildServer } from "./server.js";
import { resolveIdleTimeoutSeconds } from "./settings.js";

export type BootstrappedApp = {
  app: Awaited<ReturnType<typeof buildServer>>;
  db: ReturnType<typeof openDatabase>;
};

export async function bootstrapApp(
  cfg: ReturnType<typeof loadConfig> = loadConfig(),
): Promise<BootstrappedApp> {
  const instance = await ensureDataDir(cfg.dataDir);
  const db = openDatabase(cfg.dataDir);
  runHousekeeping(db);

  const idleMinutes = resolveIdleTimeoutSeconds(db) / 60;
  if (idleMinutes < 15 || idleMinutes > 30) {
    console.warn(
      `Session idle timeout ${idleMinutes} minutes is outside the recommended 15-30 minute band`,
    );
  }

  const setupGate = await openSetupGate({
    dataDir: cfg.dataDir,
    vaultInitialized: isVaultInitialized(db),
  });

  const app = await buildServer({
    dataDir: cfg.dataDir,
    webDir: cfg.webDir,
    logLevel: cfg.logLevel,
    instance,
    db,
    setupGate,
    requireHttpsSetup: cfg.requireHttpsSetup,
  });

  if (setupGate.token) {
    console.log(`────────────────────────────────────────────────────────────────
  KeyPage first-boot setup token is ready.

  Read it from: ${setupGate.filePath}
  (mode 0600; host path is <KEYPAGE_DATA_DIR>/setup-token)
  Paste it on the setup screen to claim this vault.
  Anyone who can reach this server but cannot read this file
  cannot claim the vault.
────────────────────────────────────────────────────────────────`);
    if (cfg.requireHttpsSetup) {
      console.warn(
        "KEYPAGE_REQUIRE_HTTPS_SETUP is on: POST /setup is rejected over clear HTTP. Use Cloudflare Tunnel or a TLS reverse proxy (and KEYPAGE_TRUST_PROXY=true if TLS terminates in front of KeyPage).",
      );
    } else {
      console.warn(
        "First-boot setup over plain HTTP exposes the setup POST body (including the setup token) to anyone who can observe this LAN. Prefer Cloudflare Tunnel or a TLS reverse proxy before claiming the vault, or set KEYPAGE_REQUIRE_HTTPS_SETUP=true to reject cleartext claims.",
      );
    }
  }

  return { app, db };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isDirectRun()) {
  try {
    const cfg = loadConfig();
    const { app, db } = await bootstrapApp(cfg);
    await app.listen({ port: cfg.port, host: cfg.host });
    app.log.info(`listening on ${cfg.host}:${cfg.port}`);

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
  } catch (error: unknown) {
    console.error(error);
    process.exit(1);
  }
}
