import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { SETUP_TOKEN_PATTERN } from "@keypage/shared";

import { openSetupGate, SETUP_TOKEN_FILENAME } from "./setup-token.js";

describe("setup token gate (SAA-174)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keypage-setup-token-"));
    tempDirs.push(dir);
    return dir;
  }

  it("mints a token that matches SETUP_TOKEN_PATTERN and writes the file with mode 0600", async () => {
    const dataDir = await makeTempDir();
    const gate = await openSetupGate({
      dataDir,
      vaultInitialized: false,
    });

    assert.ok(gate.token);
    assert.match(gate.token, new RegExp(SETUP_TOKEN_PATTERN));

    const filePath = path.join(dataDir, SETUP_TOKEN_FILENAME);
    assert.equal((statSync(filePath).mode & 0o777), 0o600);
    assert.equal((await fs.readFile(filePath, "utf8")).trim(), gate.token);
  });

  it("reuses the same token when openSetupGate runs again on the same dir", async () => {
    const dataDir = await makeTempDir();
    const first = await openSetupGate({
      dataDir,
      vaultInitialized: false,
    });
    const second = await openSetupGate({
      dataDir,
      vaultInitialized: false,
    });

    assert.equal(second.token, first.token);
  });

  it("consume() deletes the file, flips token to null, and makes verify false", async () => {
    const dataDir = await makeTempDir();
    const gate = await openSetupGate({
      dataDir,
      vaultInitialized: false,
    });
    const correctToken = gate.token!;
    const filePath = path.join(dataDir, SETUP_TOKEN_FILENAME);

    await gate.consume();

    assert.equal(gate.token, null);
    await assert.rejects(() => fs.stat(filePath), { code: "ENOENT" });
    assert.equal(gate.verify(correctToken), false);
  });

  it("remints when the existing file is not a valid setup token", async () => {
    const dataDir = await makeTempDir();
    const filePath = path.join(dataDir, SETUP_TOKEN_FILENAME);
    await fs.writeFile(filePath, "not-a-valid-token\n", { mode: 0o600 });

    const gate = await openSetupGate({
      dataDir,
      vaultInitialized: false,
    });

    assert.ok(gate.token);
    assert.match(gate.token, new RegExp(SETUP_TOKEN_PATTERN));
    assert.notEqual(gate.token, "not-a-valid-token");
    assert.equal((await fs.readFile(filePath, "utf8")).trim(), gate.token);
  });

  it("vaultInitialized: true deletes a pre-existing token file and yields token: null", async () => {
    const dataDir = await makeTempDir();
    const filePath = path.join(dataDir, SETUP_TOKEN_FILENAME);
    await fs.writeFile(filePath, "stale-token\n");

    const gate = await openSetupGate({
      dataDir,
      vaultInitialized: true,
    });

    assert.equal(gate.token, null);
    await assert.rejects(() => fs.stat(filePath), { code: "ENOENT" });
    assert.equal(gate.verify("anything"), false);
  });

  it("maps EACCES while reading an existing token file to a bind-mount error", async () => {
    const dataDir = await makeTempDir();
    const filePath = path.join(dataDir, SETUP_TOKEN_FILENAME);
    await fs.writeFile(filePath, "stale-token\n", { mode: 0o600 });
    await fs.chmod(filePath, 0o000);

    try {
      await assert.rejects(
        () => openSetupGate({ dataDir, vaultInitialized: false }),
        /Cannot write the first-boot setup token/,
      );
    } finally {
      await fs.chmod(filePath, 0o600);
    }
  });
});
