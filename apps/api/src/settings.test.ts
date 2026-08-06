import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import Database from "better-sqlite3";

import {
  CLIPBOARD_CLEAR_SECONDS_MAX,
  CLIPBOARD_CLEAR_SECONDS_MIN,
  DEFAULT_CLIPBOARD_CLEAR_SECONDS,
  DEFAULT_SESSION_IDLE_MINUTES,
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
});
