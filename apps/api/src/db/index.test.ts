import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { closeDatabase, openDatabase } from "./index.js";

describe("openDatabase / closeDatabase", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates keypage.db with mode 0600, WAL, and migrated schema", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-db-"));
    tempDirs.push(dir);

    const db = openDatabase(dir);
    try {
      const dbPath = path.join(dir, "keypage.db");
      assert.equal(fs.existsSync(dbPath), true);
      assert.equal(fs.statSync(dbPath).mode & 0o777, 0o600);

      const journal = db.pragma("journal_mode", { simple: true });
      assert.equal(String(journal).toLowerCase(), "wal");

      const version = db.pragma("user_version", { simple: true });
      assert.equal(version, 5);

      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vault_auth'`,
        )
        .get() as { name: string } | undefined;
      assert.equal(tables?.name, "vault_auth");
    } finally {
      closeDatabase(db);
    }

    assert.throws(() => db.prepare("SELECT 1").get(), /closed/i);
  });

  it("creates nested data directories when they do not exist", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "keypage-db-parent-"));
    tempDirs.push(parent);
    const dir = path.join(parent, "nested", "data");

    const db = openDatabase(dir);
    try {
      assert.equal(fs.existsSync(path.join(dir, "keypage.db")), true);
    } finally {
      closeDatabase(db);
    }
  });
});
