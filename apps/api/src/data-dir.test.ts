import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { DATA_DIR_SCHEMA_VERSION, ensureDataDir } from "./data-dir.js";

describe("ensureDataDir", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keypage-data-dir-"));
    tempDirs.push(dir);
    return dir;
  }

  it("creates instance.json with schema version and firstBootAt on first boot", async () => {
    const parent = await makeTempDir();
    const dir = path.join(parent, "nested", "data");

    const record = await ensureDataDir(dir);

    assert.equal(record.schemaVersion, DATA_DIR_SCHEMA_VERSION);
    assert.match(record.firstBootAt, /^\d{4}-\d{2}-\d{2}T/);
    const raw = await fs.readFile(path.join(dir, "instance.json"), "utf8");
    assert.deepEqual(JSON.parse(raw), record);
  });

  it("returns the existing record without rewriting firstBootAt", async () => {
    const dir = await makeTempDir();
    const first = await ensureDataDir(dir);
    const second = await ensureDataDir(dir);

    assert.deepEqual(second, first);
    const raw = await fs.readFile(path.join(dir, "instance.json"), "utf8");
    assert.deepEqual(JSON.parse(raw), first);
  });

  it("upgrades a lower schemaVersion and preserves firstBootAt", async () => {
    const dir = await makeTempDir();
    const instancePath = path.join(dir, "instance.json");
    const firstBootAt = "2024-01-15T12:00:00.000Z";
    await fs.writeFile(
      instancePath,
      `${JSON.stringify({ firstBootAt, schemaVersion: 0 }, null, 2)}\n`,
      "utf8",
    );

    const upgraded = await ensureDataDir(dir);

    assert.deepEqual(upgraded, {
      firstBootAt,
      schemaVersion: DATA_DIR_SCHEMA_VERSION,
    });
    const raw = await fs.readFile(instancePath, "utf8");
    assert.deepEqual(JSON.parse(raw), upgraded);
  });
});
