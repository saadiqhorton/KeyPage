import type Database from "better-sqlite3";

import {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
  DEFAULT_SESSION_IDLE_MINUTES,
  LOGIN_FAILURE_WINDOW_SECONDS,
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_ATTEMPTS,
} from "@keypage/shared";

export type ThrottleConfig = {
  maxAttempts: number;
  lockoutSeconds: number;
  failureWindowSeconds: number;
};

export function resolveIdleTimeoutSeconds(db: Database.Database): number {
  const envValue = process.env.KEYPAGE_SESSION_IDLE_MINUTES;
  if (envValue !== undefined && envValue !== "") {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed)) {
      return clampIdleMinutes(parsed) * 60;
    }
  }

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get("session_idle_minutes") as { value: string } | undefined;

  if (row) {
    const parsed = Number(row.value);
    if (Number.isFinite(parsed)) {
      return clampIdleMinutes(parsed) * 60;
    }
  }

  return DEFAULT_SESSION_IDLE_MINUTES * 60;
}

export function clampClipboardClearSeconds(seconds: number): number {
  return Math.min(
    CLIPBOARD_CLEAR_SECONDS_MAX,
    Math.max(CLIPBOARD_CLEAR_SECONDS_MIN, Math.round(seconds)),
  );
}

export function resolveClipboardClearSeconds(db: Database.Database): number {
  const envValue = process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS;
  if (envValue !== undefined && envValue !== "") {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed)) {
      return clampClipboardClearSeconds(parsed);
    }
  }

  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get("clipboard_clear_seconds") as { value: string } | undefined;

  if (row) {
    const parsed = Number(row.value);
    if (Number.isFinite(parsed)) {
      return clampClipboardClearSeconds(parsed);
    }
  }

  return DEFAULT_CLIPBOARD_CLEAR_SECONDS;
}

function clampIdleMinutes(minutes: number): number {
  return Math.min(480, Math.max(1, Math.round(minutes)));
}

export function resolveThrottleConfig(): ThrottleConfig {
  const maxAttempts = readPositiveIntEnv(
    "KEYPAGE_LOGIN_MAX_ATTEMPTS",
    LOGIN_MAX_ATTEMPTS,
  );

  const lockoutMinutes = readPositiveIntEnv(
    "KEYPAGE_LOGIN_LOCKOUT_MINUTES",
    LOGIN_LOCKOUT_SECONDS / 60,
  );

  const failureWindowSeconds = readPositiveIntEnv(
    "KEYPAGE_LOGIN_FAILURE_WINDOW_SECONDS",
    LOGIN_FAILURE_WINDOW_SECONDS,
  );

  return {
    maxAttempts,
    lockoutSeconds: lockoutMinutes * 60,
    failureWindowSeconds,
  };
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
