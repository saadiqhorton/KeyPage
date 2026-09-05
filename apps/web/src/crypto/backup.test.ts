import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKUP_FORMAT_VERSION,
  PBKDF2_FALLBACK_ITERATIONS,
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

const PRESET_KDF: KdfParams = {
  algorithm: "pbkdf2-sha256",
  saltB64: base64Encode(new Uint8Array(16).fill(7)),
  iterations: PBKDF2_FALLBACK_ITERATIONS,
};

const ARGON2ID_PRESET_KDF: KdfParams = {
  algorithm: "argon2id",
  saltB64: base64Encode(new Uint8Array(16).fill(7)),
  iterations: 3,
  memoryKiB: 65536,
  parallelism: 1,
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

function headerBase(kdf: KdfParams) {
  return {
    magic: "keypage-backup",
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
    kdf,
    cipher: {
      algorithm: "aes-256-gcm",
      ivB64: base64Encode(new Uint8Array(12).fill(1)),
      ciphertextB64: base64Encode(new Uint8Array(32).fill(2)),
    },
  };
}

describe("backup crypto", () => {
  it("encrypts with FAST_KDF", async () => {
    const payload = samplePayload();
    const file = await encryptBackup("backup-password", payload, FAST_KDF);
    assert.equal(file.kdf.algorithm, "pbkdf2-sha256");
    assert.equal(file.kdf.iterations, 1000);
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
      PRESET_KDF,
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
      PRESET_KDF,
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
      PRESET_KDF,
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
      PRESET_KDF,
    );
    const text = serializeBackupFile(file);
    assert.equal(text.includes(secret), false);
  });

  it("rejects invalid backup file headers", () => {
    const base = headerBase(PRESET_KDF);

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

  it("accepts both real export KDF presets", () => {
    const base = headerBase(PRESET_KDF);
    assert.doesNotThrow(() =>
      parseBackupFile(JSON.stringify({ ...base, kdf: PRESET_KDF })),
    );
    assert.doesNotThrow(() =>
      parseBackupFile(JSON.stringify({ ...base, kdf: ARGON2ID_PRESET_KDF })),
    );
  });

  it("rejects attacker KDF headers that are not export presets", () => {
    const base = headerBase(PRESET_KDF);
    const attackerKdfs: KdfParams[] = [
      { ...ARGON2ID_PRESET_KDF, memoryKiB: 262_144 },
      { ...ARGON2ID_PRESET_KDF, memoryKiB: 131_072 },
      { ...ARGON2ID_PRESET_KDF, iterations: 10 },
      { ...ARGON2ID_PRESET_KDF, parallelism: 2 },
      { ...PRESET_KDF, iterations: 2_000_000 },
      { ...PRESET_KDF, iterations: 1_000 },
    ];
    for (const kdf of attackerKdfs) {
      assert.throws(
        () => parseBackupFile(JSON.stringify({ ...base, kdf })),
        BackupFormatError,
      );
    }
  });

  it("rejects a mutated header before any derivation", async () => {
    const file = await encryptBackup(
      "backup-password",
      samplePayload(),
      PRESET_KDF,
    );
    file.kdf = {
      ...ARGON2ID_PRESET_KDF,
      memoryKiB: 262_144,
      iterations: 10,
    };

    await assert.rejects(
      () => decryptBackup(file, "backup-password"),
      (error: unknown) => {
        assert.ok(error instanceof BackupFormatError);
        assert.ok(!(error instanceof BackupPasswordError));
        return true;
      },
    );
  });

  it("rejects the wrong password on a real-preset file", async () => {
    const file = await encryptBackup(
      "correct-password",
      samplePayload(),
      PRESET_KDF,
    );
    await assert.rejects(
      () => decryptBackup(file, "wrong-password"),
      BackupPasswordError,
    );
  });

  it("rejects out-of-clamp KDF parameters", async () => {
    const file = await encryptBackup(
      "backup-password",
      samplePayload(),
      PRESET_KDF,
    );
    file.kdf = {
      ...PRESET_KDF,
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

  it("rejects backup entries with invalid field shapes", () => {
    const cases: Array<{ entry: unknown; message: string }> = [
      { entry: "not-an-object", message: "Entry 0 is invalid" },
      {
        entry: sampleEntry({ customServiceName: 1 as unknown as string }),
        message: "Entry 0 has an invalid customServiceName",
      },
      {
        entry: sampleEntry({ description: 1 as unknown as string }),
        message: "Entry 0 has an invalid description",
      },
      {
        entry: sampleEntry({ keyValue: "" }),
        message: "Entry 0 has an invalid keyValue",
      },
      {
        entry: sampleEntry({ lastUsedAt: 1 as unknown as string }),
        message: "Entry 0 has an invalid lastUsedAt",
      },
    ];
    for (const { entry, message } of cases) {
      assert.throws(
        () =>
          validateBackupPayload({
            ...samplePayload(),
            entries: [entry],
            entryCount: 1,
          }),
        (error: unknown) => {
          assert.ok(error instanceof BackupFormatError);
          assert.equal(error.message, message);
          return true;
        },
      );
    }
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
