import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LISTEN_HOST,
  DEFAULT_LISTEN_PORT,
  DEFAULT_SESSION_IDLE_MINUTES,
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_ATTEMPTS,
  SESSION_ABSOLUTE_HOURS,
} from "@keypage/shared";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  return raw === "true" || raw === "1";
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.round(parsed);
}

function readCsvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readPublicOrigin(): string | undefined {
  const raw = process.env.KEYPAGE_PUBLIC_ORIGIN?.trim();
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("KEYPAGE_PUBLIC_ORIGIN must contain only scheme, host, and optional port");
  }
  return url.origin;
}

export function loadConfig() {
  return {
    port: Number(process.env.PORT ?? DEFAULT_LISTEN_PORT),
    host: process.env.HOST ?? DEFAULT_LISTEN_HOST,
    dataDir: path.resolve(process.env.KEYPAGE_DATA_DIR ?? "./data"),
    webDir: path.resolve(
      process.env.KEYPAGE_WEB_DIR ?? path.join(packageRoot, "../web/dist"),
    ),
    logLevel: process.env.LOG_LEVEL ?? "info",
    trustedProxies: readCsvEnv("KEYPAGE_TRUSTED_PROXIES"),
    publicOrigin: readPublicOrigin(),
    requireHttpsSetup: readBoolEnv("KEYPAGE_REQUIRE_HTTPS_SETUP", true),
    allowInsecureLocalSetup: readBoolEnv("KEYPAGE_ALLOW_INSECURE_LOCAL_SETUP", false),
    setupTokenTtlMinutes: readPositiveIntEnv("KEYPAGE_SETUP_TOKEN_TTL_MINUTES", 15),
    sessionIdleMinutes: readPositiveIntEnv(
      "KEYPAGE_SESSION_IDLE_MINUTES",
      DEFAULT_SESSION_IDLE_MINUTES,
    ),
    sessionAbsoluteHours: readPositiveIntEnv(
      "KEYPAGE_SESSION_ABSOLUTE_HOURS",
      SESSION_ABSOLUTE_HOURS,
    ),
    loginMaxAttempts: readPositiveIntEnv(
      "KEYPAGE_LOGIN_MAX_ATTEMPTS",
      LOGIN_MAX_ATTEMPTS,
    ),
    loginLockoutMinutes: readPositiveIntEnv(
      "KEYPAGE_LOGIN_LOCKOUT_MINUTES",
      LOGIN_LOCKOUT_SECONDS / 60,
    ),
  };
}

export const config = loadConfig();
