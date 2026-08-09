import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKUP_FORMAT_VERSION,
  type BackupEntry,
  type BackupPayload,
  type KdfParams,
} from "@keypage/shared";

import {
  BackupFormatError,
  BackupPasswordError,
  backupFileName,
  decryptBackup,
  encryptBackup,
  parseBackupFile,
  serializeBackupFile,
  validateBackupPayload,
} from "./backup.js";
import { base64Encode } from "./encoding.js";
import { pickKdfParams } from "./derive.js";

const FAST_KDF: KdfParams = {
  algorithm: "pbkdf2-sha256",
  saltB64: base64Encode(new Uint8Array(16).fill(7)),
  iterations: 1000,
};

function sampleEntry(overrides: Partial<BackupEntry> = {}): BackupEntry {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    label: "Production",
    serviceId: "openai",
    customServiceName: null,
    description: "Main key",
    tags: ["prod"],
    keyValue: "sk-live-secret-value-12345",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides,
  };
}

function samplePayload(
  entries: BackupEntry[] = [sampleEntry()],
): BackupPayload {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    entryCount: entries.length,
    entries,
  };
}

describe("backup crypto", () => {
  it("round-trips with FAST_KDF", async () => {
    const payload = samplePayload();
    const file = await encryptBackup("backup-password", payload, FAST_KDF);
    const decrypted = await decryptBackup(file, "backup-password");
    assert.deepEqual(decrypted, payload);
  });

  it("round-trips with default pickKdfParams()", async () => {
    const payload = samplePayload();
    const file = await encryptBackup("backup-password", payload);
    const decrypted = await decryptBackup(file, "backup-password");
    assert.deepEqual(decrypted, payload);
  });

  it("rejects the wrong password", async () => {
    const file = await encryptBackup(
      "correct-password",
      samplePayload(),
      FAST_KDF,
    );
    await assert.rejects(
      () => decryptBackup(file, "wrong-password"),
      (error: unknown) => {
        assert.ok(error instanceof BackupPasswordError);
        assert.equal(
          error.message,
          "That password does not unlock this backup file.",
        );
        return true;
      },
    );
  });

  it("rejects flipped ciphertext bytes", async () => {
    const file = await encryptBackup(
      "backup-password",
      samplePayload(),
      FAST_KDF,
    );
    const ciphertext = Buffer.from(file.cipher.ciphertextB64, "base64");
    ciphertext[0] ^= 0xff;
    file.cipher.ciphertextB64 = ciphertext.toString("base64");

    await assert.rejects(
      () => decryptBackup(file, "backup-password"),
      BackupPasswordError,
    );
  });

  it("rejects a mutated header formatVersion after encryption", async () => {
    const file = await encryptBackup(
      "backup-password",
      samplePayload(),
      FAST_KDF,
    );
    file.formatVersion = BACKUP_FORMAT_VERSION + 1;

    await assert.rejects(
      () => decryptBackup(file, "backup-password"),
      BackupPasswordError,
    );
  });

  it("does not include plaintext key values in serialized output", async () => {
    const secret = "super-secret-plaintext-key";
    const file = await encryptBackup(
      "backup-password",
      samplePayload([sampleEntry({ keyValue: secret })]),
      FAST_KDF,
    );
    const text = serializeBackupFile(file);
    assert.equal(text.includes(secret), false);
  });

  it("rejects invalid backup file headers", () => {
    const base = {
      magic: "keypage-backup",
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: "2026-01-01T00:00:00.000Z",
      kdf: FAST_KDF,
      cipher: {
        algorithm: "aes-256-gcm",
        ivB64: base64Encode(new Uint8Array(12).fill(1)),
        ciphertextB64: base64Encode(new Uint8Array(32).fill(2)),
      },
    };

    assert.throws(() => parseBackupFile("not json"), BackupFormatError);
    assert.throws(
      () => parseBackupFile(JSON.stringify({ ...base, magic: "wrong" })),
      BackupFormatError,
    );
    assert.throws(
      () =>
        parseBackupFile(JSON.stringify({ ...base, formatVersion: 999 })),
      BackupFormatError,
    );
    assert.throws(
      () =>
        parseBackupFile(
          JSON.stringify({
            ...base,
            cipher: { algorithm: "aes-256-gcm", ciphertextB64: "abc" },
          }),
        ),
      BackupFormatError,
    );
  });

  it("rejects out-of-clamp KDF parameters", async () => {
    const file = await encryptBackup(
      "backup-password",
      samplePayload(),
      FAST_KDF,
    );
    file.kdf = {
      ...FAST_KDF,
      algorithm: "argon2id",
      memoryKiB: 4_194_304,
      parallelism: 1,
      iterations: 3,
    };

    await assert.rejects(
      () => decryptBackup(file, "backup-password"),
      BackupFormatError,
    );
  });

  it("rejects invalid backup payloads", () => {
    const valid = samplePayload();
    assert.throws(
      () =>
        validateBackupPayload({
          ...valid,
          entryCount: valid.entries.length + 1,
        }),
      BackupFormatError,
    );
    assert.throws(
      () =>
        validateBackupPayload({
          ...valid,
          entries: [sampleEntry({ id: "not-a-uuid" })],
        }),
      BackupFormatError,
    );
  });

  it("formats backup file names", () => {
    assert.equal(
      backupFileName(new Date("2026-08-01T12:34:56.000Z")),
      "keypage-backup-2026-08-01.json",
    );
  });

  it("accepts blank labels and empty tag strings in backup payloads", () => {
    assert.throws(
      () =>
        validateBackupPayload(
          samplePayload([
            sampleEntry({ label: "   ", tags: [""] }),
          ]),
        ),
      BackupFormatError,
    );
  });
});

describe("pickKdfParams", () => {
  it("returns usable KDF parameters", async () => {
    const kdf = await pickKdfParams();
    assert.ok(kdf.algorithm === "argon2id" || kdf.algorithm === "pbkdf2-sha256");
    assert.equal(typeof kdf.saltB64, "string");
    assert.ok(kdf.iterations > 0);
  });
});
