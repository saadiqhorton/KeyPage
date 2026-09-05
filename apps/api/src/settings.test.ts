import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

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
  SESSION_IDLE_MINUTES_OPTIONS,
} from "@keypage/shared";

import { runMigrations } from "./db/migrations.js";
import {
  clampClipboardClearSeconds,
  clampIdleMinutes,
  describeIdleTimeout,
  isIdleMinutesOption,
  readIdleTimeoutSetting,
  resolveClipboardClearSeconds,
  resolveIdleTimeoutSeconds,
  resolveThrottleConfig,
  writeIdleTimeoutSetting,
} from "./settings.js";

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

describe("clampClipboardClearSeconds", () => {
  it("clamps below min", () => {
    assert.equal(clampClipboardClearSeconds(0), CLIPBOARD_CLEAR_SECONDS_MIN);
    assert.equal(clampClipboardClearSeconds(4), CLIPBOARD_CLEAR_SECONDS_MIN);
  });

  it("clamps above max", () => {
    assert.equal(clampClipboardClearSeconds(301), CLIPBOARD_CLEAR_SECONDS_MAX);
    assert.equal(clampClipboardClearSeconds(1000), CLIPBOARD_CLEAR_SECONDS_MAX);
  });

  it("rounds non-integer values", () => {
    assert.equal(clampClipboardClearSeconds(29.4), 29);
    assert.equal(clampClipboardClearSeconds(29.6), 30);
  });

  it("passes exact default through", () => {
    assert.equal(
      clampClipboardClearSeconds(DEFAULT_CLIPBOARD_CLEAR_SECONDS),
      DEFAULT_CLIPBOARD_CLEAR_SECONDS,
    );
  });
});

describe("clampIdleMinutes", () => {
  it("clamps below min", () => {
    assert.equal(clampIdleMinutes(2), SESSION_IDLE_MINUTES_MIN);
    assert.equal(clampIdleMinutes(14), SESSION_IDLE_MINUTES_MIN);
  });

  it("clamps above max", () => {
    assert.equal(clampIdleMinutes(300), SESSION_IDLE_MINUTES_MAX);
    assert.equal(clampIdleMinutes(31), SESSION_IDLE_MINUTES_MAX);
  });

  it("passes in-range values through", () => {
    assert.equal(clampIdleMinutes(18), 18);
    assert.equal(clampIdleMinutes(25), 25);
  });
});

describe("isIdleMinutesOption", () => {
  it("accepts every offered option", () => {
    for (const minutes of SESSION_IDLE_MINUTES_OPTIONS) {
      assert.equal(isIdleMinutesOption(minutes), true);
    }
  });

  it("rejects in-band values that are not offered options", () => {
    assert.equal(isIdleMinutesOption(16), false);
    assert.equal(isIdleMinutesOption(22.5), false);
  });

  it("rejects values outside the offered range", () => {
    assert.equal(isIdleMinutesOption(14), false);
    assert.equal(isIdleMinutesOption(31), false);
    assert.equal(isIdleMinutesOption(0), false);
  });
});

describe("idle timeout settings", () => {
  let db: Database.Database;
  const originalEnv = process.env.KEYPAGE_SESSION_IDLE_MINUTES;

  beforeEach(() => {
    db = openMemoryDb();
  });

  afterEach(() => {
    db?.close();
    if (originalEnv === undefined) {
      delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;
    } else {
      process.env.KEYPAGE_SESSION_IDLE_MINUTES = originalEnv;
    }
  });

  it("reads and writes database setting", () => {
    assert.equal(readIdleTimeoutSetting(db), 20);
    writeIdleTimeoutSetting(db, 25);
    assert.equal(readIdleTimeoutSetting(db), 25);
  });

  it("describeIdleTimeout prefers env over database", () => {
    writeIdleTimeoutSetting(db, 25);
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "18";

    assert.deepEqual(describeIdleTimeout(db), {
      minutes: 18,
      source: "env",
    });
  });

  it("describeIdleTimeout reports database source", () => {
    writeIdleTimeoutSetting(db, 25);
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;

    assert.deepEqual(describeIdleTimeout(db), {
      minutes: 25,
      source: "database",
    });
  });

  it("describeIdleTimeout reports default when unset", () => {
    db.prepare(`DELETE FROM app_settings WHERE key = 'session_idle_minutes'`).run();
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;

    assert.deepEqual(describeIdleTimeout(db), {
      minutes: DEFAULT_SESSION_IDLE_MINUTES,
      source: "default",
    });
  });

  it("describeIdleTimeout ignores non-finite env and stored values", () => {
    process.env.KEYPAGE_SESSION_IDLE_MINUTES = "nope";
    writeIdleTimeoutSetting(db, 25);
    assert.deepEqual(describeIdleTimeout(db), {
      minutes: 25,
      source: "database",
    });

    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;
    db.prepare(
      `UPDATE app_settings SET value = 'not-a-number' WHERE key = 'session_idle_minutes'`,
    ).run();
    assert.equal(readIdleTimeoutSetting(db), undefined);
    assert.deepEqual(describeIdleTimeout(db), {
      minutes: DEFAULT_SESSION_IDLE_MINUTES,
      source: "default",
    });
  });

  it("resolveIdleTimeoutSeconds converts minutes to seconds", () => {
    writeIdleTimeoutSetting(db, 15);
    delete process.env.KEYPAGE_SESSION_IDLE_MINUTES;
    assert.equal(resolveIdleTimeoutSeconds(db), 15 * 60);
  });
});

describe("clipboard clear seconds", () => {
  let db: Database.Database;
  const originalEnv = process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS;

  beforeEach(() => {
    db = openMemoryDb();
    delete process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS;
  });

  afterEach(() => {
    db?.close();
    if (originalEnv === undefined) {
      delete process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS;
    } else {
      process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS = originalEnv;
    }
  });

  it("uses the default when unset", () => {
    assert.equal(resolveClipboardClearSeconds(db), DEFAULT_CLIPBOARD_CLEAR_SECONDS);
  });

  it("prefers a finite env value and clamps it", () => {
    process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS = "3";
    assert.equal(resolveClipboardClearSeconds(db), CLIPBOARD_CLEAR_SECONDS_MIN);

    process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS = "999";
    assert.equal(resolveClipboardClearSeconds(db), CLIPBOARD_CLEAR_SECONDS_MAX);
  });

  it("ignores non-finite env and reads a stored setting", () => {
    process.env.KEYPAGE_CLIPBOARD_CLEAR_SECONDS = "nope";
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('clipboard_clear_seconds', '45', ?)`,
    ).run(now);
    assert.equal(resolveClipboardClearSeconds(db), 45);

    db.prepare(
      `UPDATE app_settings SET value = 'bad' WHERE key = 'clipboard_clear_seconds'`,
    ).run();
    assert.equal(
      resolveClipboardClearSeconds(db),
      DEFAULT_CLIPBOARD_CLEAR_SECONDS,
    );
  });
});

describe("resolveThrottleConfig", () => {
  const keys = [
    "KEYPAGE_LOGIN_MAX_ATTEMPTS",
    "KEYPAGE_LOGIN_LOCKOUT_MINUTES",
    "KEYPAGE_LOGIN_FAILURE_WINDOW_SECONDS",
  ] as const;
  const original: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  });

  it("returns shared defaults when env is unset or invalid", () => {
    for (const key of keys) {
      original[key] = process.env[key];
      delete process.env[key];
    }

    assert.deepEqual(resolveThrottleConfig(), {
      maxAttempts: LOGIN_MAX_ATTEMPTS,
      lockoutSeconds: LOGIN_LOCKOUT_SECONDS,
      failureWindowSeconds: LOGIN_FAILURE_WINDOW_SECONDS,
    });

    process.env.KEYPAGE_LOGIN_MAX_ATTEMPTS = "0";
    process.env.KEYPAGE_LOGIN_LOCKOUT_MINUTES = "abc";
    process.env.KEYPAGE_LOGIN_FAILURE_WINDOW_SECONDS = "";
    assert.deepEqual(resolveThrottleConfig(), {
      maxAttempts: LOGIN_MAX_ATTEMPTS,
      lockoutSeconds: LOGIN_LOCKOUT_SECONDS,
      failureWindowSeconds: LOGIN_FAILURE_WINDOW_SECONDS,
    });
  });

  it("reads positive integer overrides", () => {
    for (const key of keys) {
      original[key] = process.env[key];
    }
    process.env.KEYPAGE_LOGIN_MAX_ATTEMPTS = "9";
    process.env.KEYPAGE_LOGIN_LOCKOUT_MINUTES = "2";
    process.env.KEYPAGE_LOGIN_FAILURE_WINDOW_SECONDS = "120";

    assert.deepEqual(resolveThrottleConfig(), {
      maxAttempts: 9,
      lockoutSeconds: 120,
      failureWindowSeconds: 120,
    });
  });
});
