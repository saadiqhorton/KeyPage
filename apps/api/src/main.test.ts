import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { APP_NAME, HEALTH_STATUS_OK } from "@keypage/shared";

import { loadConfig } from "./config.js";
import { closeDatabase } from "./db/index.js";
import { bootstrapApp } from "./main.js";

const ENV_KEYS = [
  "KEYPAGE_DATA_DIR",
  "KEYPAGE_WEB_DIR",
  "LOG_LEVEL",
  "KEYPAGE_SESSION_IDLE_MINUTES",
  "KEYPAGE_REQUIRE_HTTPS_SETUP",
] as const;

async function captureStdio<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const chunks: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origInfo = console.info;
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  const collectArgs = (...args: unknown[]) => {
    chunks.push(args.map(String).join(" "));
  };
  const wrapWrite =
    (orig: typeof process.stdout.write): typeof process.stdout.write =>
    ((chunk: unknown, ...rest: unknown[]) => {
      chunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return orig(chunk as never, ...(rest as never[]));
    }) as typeof process.stdout.write;

  console.log = collectArgs;
  console.warn = collectArgs;
  console.error = collectArgs;
  console.info = collectArgs;
  process.stdout.write = wrapWrite(origStdout);
  process.stderr.write = wrapWrite(origStderr);

  try {
    const result = await fn();
    return { result, output: chunks.join("\n") };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    console.info = origInfo;
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }
}

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
      assert.equal(health.json().status, HEALTH_STATUS_OK);
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

  it("does not write the setup token to console or stdio (SAA-217)", async () => {
    snapshotEnv();
    const dataDir = await makeTempDir();
    process.env.KEYPAGE_DATA_DIR = dataDir;
    process.env.KEYPAGE_WEB_DIR = path.join(dataDir, "no-web");
    process.env.LOG_LEVEL = "silent";
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;
    delete process.env.KEYPAGE_REQUIRE_HTTPS_SETUP;

    const { result, output } = await captureStdio(() => bootstrapApp(loadConfig()));
    const { app, db } = result;
    try {
      const tokenFile = path.join(dataDir, "setup-token");
      const token = (await fs.readFile(tokenFile, "utf8")).trim();
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(output.includes(token), false, "plaintext setup token must not appear in logs");
      assert.match(output, /setup-token/);
      assert.match(output, new RegExp(tokenFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(output, /HTTPS-first setup is on/);
    } finally {
      await app.close();
      closeDatabase(db);
    }
  });

  it("warns that HTTPS setup is required when the opt-in flag is on (SAA-223)", async () => {
    snapshotEnv();
    const dataDir = await makeTempDir();
    process.env.KEYPAGE_DATA_DIR = dataDir;
    process.env.KEYPAGE_WEB_DIR = path.join(dataDir, "no-web");
    process.env.LOG_LEVEL = "silent";
    process.env.KEYPAGE_REQUIRE_HTTPS_SETUP = "true";
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;

    const { result, output } = await captureStdio(() => bootstrapApp(loadConfig()));
    const { app, db } = result;
    try {
      const token = (await fs.readFile(path.join(dataDir, "setup-token"), "utf8")).trim();
      assert.equal(output.includes(token), false, "plaintext setup token must not appear in logs");
      assert.match(output, /HTTPS-first setup is on/);
      assert.equal(output.includes("plain HTTP exposes the setup POST body"), false);
    } finally {
      await app.close();
      closeDatabase(db);
    }
  });

  it("clamps an out-of-band KEYPAGE_SESSION_IDLE_MINUTES env value at bootstrap", async () => {
    snapshotEnv();
    const dataDir = await makeTempDir();
    process.env.KEYPAGE_DATA_DIR = dataDir;
    process.env.KEYPAGE_WEB_DIR = path.join(dataDir, "no-web");
    process.env.LOG_LEVEL = "silent";
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "10";

    const { app, db } = await bootstrapApp(loadConfig());
    try {
      const status = await app.inject({ method: "GET", url: "/api/vault/status" });
      assert.equal(status.statusCode, 200);
      assert.equal(status.json().session.idleTimeoutSeconds, 15 * 60);
    } finally {
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
