import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  DEFAULT_LISTEN_HOST,
  DEFAULT_LISTEN_PORT,
  DEFAULT_SESSION_IDLE_MINUTES,
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_ATTEMPTS,
  SESSION_ABSOLUTE_HOURS,
} from "@keypage/shared";

import { loadConfig } from "./config.js";

const KEYS = [
  "PORT",
  "HOST",
  "KEYPAGE_DATA_DIR",
  "KEYPAGE_WEB_DIR",
  "LOG_LEVEL",
  "KEYPAGE_TRUSTED_PROXIES",
  "KEYPAGE_PUBLIC_ORIGIN",
  "KEYPAGE_REQUIRE_HTTPS_SETUP",
  "KEYPAGE_ALLOW_INSECURE_LOCAL_SETUP",
  "KEYPAGE_SETUP_TOKEN_TTL_MINUTES",
  "KEYPAGE_SESSION_IDLE_MINUTES",
  "KEYPAGE_SESSION_ABSOLUTE_HOURS",
  "KEYPAGE_LOGIN_MAX_ATTEMPTS",
  "KEYPAGE_LOGIN_LOCKOUT_MINUTES",
] as const;

describe("loadConfig", () => {
  const original: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  function snapshotEnv(): void {
    for (const key of KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  }

  it("uses documented defaults when env is unset", () => {
    snapshotEnv();
    const cfg = loadConfig();

    assert.equal(cfg.port, DEFAULT_LISTEN_PORT);
    assert.equal(cfg.host, DEFAULT_LISTEN_HOST);
    assert.equal(cfg.dataDir, path.resolve("./data"));
    assert.equal(cfg.logLevel, "info");
    assert.deepEqual(cfg.trustedProxies, []);
    assert.equal(cfg.publicOrigin, undefined);
    assert.equal(cfg.requireHttpsSetup, true);
    assert.equal(cfg.allowInsecureLocalSetup, false);
    assert.equal(cfg.setupTokenTtlMinutes, 15);
    assert.equal(cfg.sessionIdleMinutes, DEFAULT_SESSION_IDLE_MINUTES);
    assert.equal(cfg.sessionAbsoluteHours, SESSION_ABSOLUTE_HOURS);
    assert.equal(cfg.loginMaxAttempts, LOGIN_MAX_ATTEMPTS);
    assert.equal(cfg.loginLockoutMinutes, LOGIN_LOCKOUT_SECONDS / 60);
    assert.match(cfg.webDir, /web\/dist$/);
  });

  it("reads positive ints, bools, and paths from env", () => {
    snapshotEnv();
    process.env.PORT = "8088";
    process.env.HOST = "127.0.0.1";
    process.env.KEYPAGE_DATA_DIR = "/tmp/keypage-config-data";
    process.env.KEYPAGE_WEB_DIR = "/tmp/keypage-config-web";
    process.env.LOG_LEVEL = "error";
    process.env.KEYPAGE_TRUSTED_PROXIES = "127.0.0.1, 10.0.0.0/24";
    process.env.KEYPAGE_PUBLIC_ORIGIN = "https://keys.example.com";
    process.env.KEYPAGE_REQUIRE_HTTPS_SETUP = "true";
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "25";
    process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS = "6";
    process.env.KEYPAGE_LOGIN_MAX_ATTEMPTS = "7";
    process.env.KEYPAGE_LOGIN_LOCKOUT_MINUTES = "10";

    const cfg = loadConfig();

    assert.equal(cfg.port, 8088);
    assert.equal(cfg.host, "127.0.0.1");
    assert.equal(cfg.dataDir, path.resolve("/tmp/keypage-config-data"));
    assert.equal(cfg.webDir, path.resolve("/tmp/keypage-config-web"));
    assert.equal(cfg.logLevel, "error");
    assert.deepEqual(cfg.trustedProxies, ["127.0.0.1", "10.0.0.0/24"]);
    assert.equal(cfg.publicOrigin, "https://keys.example.com");
    assert.equal(cfg.requireHttpsSetup, true);
    assert.equal(cfg.sessionIdleMinutes, 25);
    assert.equal(cfg.sessionAbsoluteHours, 6);
    assert.equal(cfg.loginMaxAttempts, 7);
    assert.equal(cfg.loginLockoutMinutes, 10);
  });

  it("reads booleans and falls back on invalid ints", () => {
    snapshotEnv();
    process.env.KEYPAGE_REQUIRE_HTTPS_SETUP = "1";
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "0";
    process.env.KEYPAGE_SESSION_ABSOLUTE_HOURS = "nope";
    process.env.KEYPAGE_LOGIN_MAX_ATTEMPTS = "";
    process.env.KEYPAGE_LOGIN_LOCKOUT_MINUTES = "-3";

    const cfg = loadConfig();

    assert.equal(cfg.requireHttpsSetup, true);
    assert.equal(cfg.sessionIdleMinutes, DEFAULT_SESSION_IDLE_MINUTES);
    assert.equal(cfg.sessionAbsoluteHours, SESSION_ABSOLUTE_HOURS);
    assert.equal(cfg.loginMaxAttempts, LOGIN_MAX_ATTEMPTS);
    assert.equal(cfg.loginLockoutMinutes, LOGIN_LOCKOUT_SECONDS / 60);
  });

  it("treats empty and non-true boolean values as false", () => {
    snapshotEnv();
    process.env.KEYPAGE_REQUIRE_HTTPS_SETUP = "";
    assert.equal(loadConfig().requireHttpsSetup, true);

    process.env.KEYPAGE_REQUIRE_HTTPS_SETUP = "false";
    assert.equal(loadConfig().requireHttpsSetup, false);

    process.env.KEYPAGE_REQUIRE_HTTPS_SETUP = "yes";
    assert.equal(loadConfig().requireHttpsSetup, false);
  });

  it("rejects a public origin with path or credentials", () => {
    snapshotEnv();
    process.env.KEYPAGE_PUBLIC_ORIGIN = "https://user:pass@keys.example.com/path";
    assert.throws(() => loadConfig(), /only scheme, host/);
  });

  it("rounds a fractional positive int env value", () => {
    snapshotEnv();
    process.env.KEYPAGE_LOGIN_MAX_ATTEMPTS = "4.6";
    assert.equal(loadConfig().loginMaxAttempts, 5);
  });
});
