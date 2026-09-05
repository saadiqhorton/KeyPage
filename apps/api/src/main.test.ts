import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { APP_NAME } from "@keypage/shared";

import { loadConfig } from "./config.js";
import { closeDatabase } from "./db/index.js";
import { bootstrapApp } from "./main.js";

const ENV_KEYS = [
  "KEYPAGE_DATA_DIR",
  "KEYPAGE_WEB_DIR",
  "LOG_LEVEL",
  "KEYPAGE_SESSION_IDLE_MINUTES",
] as const;

describe("bootstrapApp", () => {
  const tempDirs: string[] = [];
  const original: Record<string, string | undefined> = {};

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keypage-boot-"));
    tempDirs.push(dir);
    return dir;
  }

  function snapshotEnv(): void {
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
    }
  }

  it("creates the data dir, mints a setup token, and serves health without listening", async () => {
    snapshotEnv();
    const dataDir = await makeTempDir();
    process.env.KEYPAGE_DATA_DIR = dataDir;
    process.env.KEYPAGE_WEB_DIR = path.join(dataDir, "no-web");
    process.env.LOG_LEVEL = "silent";
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;

    const { app, db } = await bootstrapApp(loadConfig());
    try {
      const health = await app.inject({ method: "GET", url: "/api/health" });
      assert.equal(health.statusCode, 200);
      assert.equal(health.json().status, "ok");
      assert.equal(health.json().app, APP_NAME);
      assert.equal(health.json().dataDir, path.resolve(dataDir));

      const status = await app.inject({ method: "GET", url: "/api/vault/status" });
      assert.equal(status.statusCode, 200);
      assert.equal(status.json().state, "setup_required");

      const tokenFile = await fs.readFile(path.join(dataDir, "setup-token"), "utf8");
      assert.match(tokenFile.trim(), /^[A-Za-z0-9_-]{43}$/);
      const instance = JSON.parse(
        await fs.readFile(path.join(dataDir, "instance.json"), "utf8"),
      ) as { schemaVersion: number };
      assert.equal(instance.schemaVersion, 1);
    } finally {
      await app.close();
      closeDatabase(db);
    }
  });

  it("warns when the idle timeout is outside 15-30 minutes", async () => {
    snapshotEnv();
    const dataDir = await makeTempDir();
    process.env.KEYPAGE_DATA_DIR = dataDir;
    process.env.KEYPAGE_WEB_DIR = path.join(dataDir, "no-web");
    process.env.LOG_LEVEL = "silent";
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "10";

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    const { app, db } = await bootstrapApp(loadConfig());
    try {
      assert.ok(
        warnings.some((line) =>
          line.includes("outside the recommended 15-30 minute band"),
        ),
      );
    } finally {
      console.warn = originalWarn;
      await app.close();
      closeDatabase(db);
    }
  });

  it("serves the built web UI when KEYPAGE_WEB_DIR contains index.html", async () => {
    snapshotEnv();
    const dataDir = await makeTempDir();
    const webDir = await makeTempDir();
    await fs.writeFile(path.join(webDir, "index.html"), "<html>booted</html>", "utf8");
    process.env.KEYPAGE_DATA_DIR = dataDir;
    process.env.KEYPAGE_WEB_DIR = webDir;
    process.env.LOG_LEVEL = "silent";
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;

    const { app, db } = await bootstrapApp(loadConfig());
    try {
      const page = await app.inject({ method: "GET", url: "/" });
      assert.equal(page.statusCode, 200);
      assert.match(page.body, /booted/);
    } finally {
      await app.close();
      closeDatabase(db);
    }
  });
});
