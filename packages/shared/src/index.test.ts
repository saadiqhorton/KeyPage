import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APP_NAME,
  BACKUP_MAGIC,
  KEY_ENTRY_LABEL_MAX,
  SERVICE_CATALOG,
  ARGON2ID_VAULT_PARAMS,
  formatRecoveryCode,
  getService,
  isExportedBackupKdf,
  loginStoredKeyHexFromAuthKey,
  normalizeLabel,
  normalizeRecoveryCode,
} from "./index.js";

describe("package index re-exports", () => {
  it("surfaces app, catalog, vault, auth, recovery, key-entry, and backup APIs", () => {
    assert.equal(APP_NAME, "KeyPage");
    assert.ok(SERVICE_CATALOG.length > 0);
    assert.equal(getService("github").id, "github");
    assert.equal(ARGON2ID_VAULT_PARAMS.iterations, 3);

    const authKey = new Uint8Array(32).fill(4);
    assert.match(loginStoredKeyHexFromAuthKey(authKey), /^[0-9a-f]{64}$/);

    const normalized = normalizeRecoveryCode("3f7kq9mtxb2wvhd8zcrn");
    assert.equal(formatRecoveryCode(normalized!), "3F7KQ-9MTXB-2WVHD-8ZCRN");

    assert.equal(KEY_ENTRY_LABEL_MAX, 120);
    assert.equal(normalizeLabel("  ok  "), "ok");
    assert.equal(BACKUP_MAGIC, "keypage-backup");
    assert.equal(
      isExportedBackupKdf({
        algorithm: "pbkdf2-sha256",
        saltB64: "x",
        iterations: 600_000,
      }),
      true,
    );
  });
});
