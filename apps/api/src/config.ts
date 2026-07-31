import path from "node:path";
import { fileURLToPath } from "node:url";

import {
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

export const config = {
  port: Number(process.env.PORT ?? 9090),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(process.env.KEYPAGE_DATA_DIR ?? "./data"),
  webDir: path.resolve(
    process.env.KEYPAGE_WEB_DIR ?? path.join(packageRoot, "../web/dist"),
  ),
  logLevel: process.env.LOG_LEVEL ?? "info",
  trustProxy: readBoolEnv("KEYPAGE_TRUST_PROXY", false),
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
} as const;
