import type Database from "better-sqlite3";

import {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
  DEFAULT_SESSION_IDLE_MINUTES,
  LOGIN_FAILURE_WINDOW_SECONDS,
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_ATTEMPTS,
  SESSION_IDLE_MINUTES_MAX,
  SESSION_IDLE_MINUTES_MIN,
  type IdleTimeoutSource,
} from "@keypage/shared";

export type ThrottleConfig = {
  maxAttempts: number;
  lockoutSeconds: number;
  failureWindowSeconds: number;
};

const SESSION_IDLE_SETTING_KEY = "session_idle_minutes";

export function clampIdleMinutes(minutes: number): number {
  return Math.min(480, Math.max(1, Math.round(minutes)));
}

export function isIdleMinutesInBand(minutes: number): boolean {
  const rounded = Math.round(minutes);
  return (
    rounded >= SESSION_IDLE_MINUTES_MIN && rounded <= SESSION_IDLE_MINUTES_MAX
  );
}

export function readIdleTimeoutSetting(
  db: Database.Database,
): number | undefined {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(SESSION_IDLE_SETTING_KEY) as { value: string } | undefined;

  if (!row) {
    return undefined;
  }

  const parsed = Number(row.value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return clampIdleMinutes(parsed);
}

export function writeIdleTimeoutSetting(
  db: Database.Database,
  minutes: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SESSION_IDLE_SETTING_KEY, String(Math.round(minutes)), now);
}

export function describeIdleTimeout(db: Database.Database): {
  minutes: number;
  source: IdleTimeoutSource;
} {
  const envValue = process.env.KEYPAGE_SESSION_IDLE_MINUTES;
  if (envValue !== undefined && envValue !== "") {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed)) {
      return { minutes: clampIdleMinutes(parsed), source: "env" };
    }
  }

  const stored = readIdleTimeoutSetting(db);
  if (stored !== undefined) {
    return { minutes: stored, source: "database" };
  }

  return { minutes: DEFAULT_SESSION_IDLE_MINUTES, source: "default" };
}

export function resolveIdleTimeoutSeconds(db: Database.Database): number {
  const { minutes } = describeIdleTimeout(db);
  return minutes * 60;
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
