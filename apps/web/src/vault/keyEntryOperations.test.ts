import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  BackupEntry,
  KeyEntry,
  KeyEntryCipherInput,
  KeyEntryCreateRequest,
  KeyEntryCreateResponse,
  KeyEntryImportRequest,
  KeyEntryImportResponse,
  KeyEntryUpdateRequest,
  KeyEntryUpdateResponse,
  KeyEntryUseResponse,
} from "@keypage/shared";

import { ApiError } from "@/lib/api.js";
import {
  ClipboardWriteError,
  type ClipboardAutoClearHandle,
} from "@/lib/clipboard.js";
import type { KeyVersionPin } from "./key-version-pin.js";
import {
  createKeyEntryOperations,
  type KeyEntryOperationsPorts,
} from "./keyEntryOperations.js";

const ENTRY_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440001";

const SAMPLE_ENTRY: KeyEntry = {
  id: ENTRY_ID,
  label: "Production",
  serviceId: "openai",
  customServiceName: null,
  description: null,
  tags: ["prod"],
  cipher: {
    algorithm: "aes-256-gcm",
    ivB64: "AAAAAAAAAAAAAAAA",
    ciphertextB64: "BBBBBBBBBBBBBBBBBBBBBBBB",
    keyVersion: 1,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
};

const SAMPLE_CIPHER: KeyEntryCipherInput = {
  algorithm: "aes-256-gcm",
  ivB64: "CCCCCCCCCCCCCCCC",
  ciphertextB64: "DDDDDDDDDDDDDDDDDDDDDDDD",
  keyVersion: 1,
};

const ENTRY_A: BackupEntry = {
  id: ENTRY_ID,
  label: "A",
  serviceId: "openai",
  customServiceName: null,
  description: null,
  tags: ["prod"],
  keyValue: "sk-a",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
};

const ENTRY_B: BackupEntry = {
  ...ENTRY_A,
  id: OTHER_ENTRY_ID,
  label: "B",
  keyValue: "sk-b",
};

function createFakePin(
  overrides: Partial<KeyVersionPin> = {},
): {
  pin: KeyVersionPin;
  calls: {
    guardWrite: number;
    requireForWrite: number;
    encryptKeyValue: Array<{ id: string; keyValue: string }>;
  };
} {
  const calls = {
    guardWrite: 0,
    requireForWrite: 0,
    encryptKeyValue: [] as Array<{ id: string; keyValue: string }>,
  };

  const pin: KeyVersionPin = {
    current: () => 1,
    requireForWrite: () => {
      calls.requireForWrite += 1;
      return 1;
    },
    encryptKeyValue: async (id, keyValue) => {
      calls.encryptKeyValue.push({ id, keyValue });
      return SAMPLE_CIPHER;
    },
    guardWrite: async (promise) => {
      calls.guardWrite += 1;
      return promise;
    },
    ...overrides,
  };

  return { pin, calls };
}

function createFakePorts(
  overrides: Partial<KeyEntryOperationsPorts> = {},
  pinOverrides: Partial<KeyVersionPin> = {},
): {
  ports: KeyEntryOperationsPorts;
  calls: {
    guardWrite: number;
    requireForWrite: number;
    postKeyEntry: KeyEntryCreateRequest[];
    patchKeyEntry: Array<{ id: string; body: KeyEntryUpdateRequest }>;
    deleteKeyEntry: Array<{ id: string; keyVersion: number }>;
    postKeyEntryUse: Array<{ id: string; action: string }>;
    postKeyEntryImport: KeyEntryImportRequest[];
    encryptKeyValue: Array<{ id: string; keyValue: string }>;
    decryptKeyValue: KeyEntry[];
    copyTextWithAutoClear: Array<{ text: string; clearMs: number }>;
  };
} {
  const { pin, calls: pinCalls } = createFakePin(pinOverrides);

  const calls = {
    guardWrite: 0,
    requireForWrite: 0,
    postKeyEntry: [] as KeyEntryCreateRequest[],
    patchKeyEntry: [] as Array<{ id: string; body: KeyEntryUpdateRequest }>,
    deleteKeyEntry: [] as Array<{ id: string; keyVersion: number }>,
    postKeyEntryUse: [] as Array<{ id: string; action: string }>,
    postKeyEntryImport: [] as KeyEntryImportRequest[],
    encryptKeyValue: [] as Array<{ id: string; keyValue: string }>,
    decryptKeyValue: [] as KeyEntry[],
    copyTextWithAutoClear: [] as Array<{ text: string; clearMs: number }>,
  };

  const ports: KeyEntryOperationsPorts = {
    pin,
    newKeyEntryId: () => ENTRY_ID,
    decryptKeyValue: async (entry) => {
      calls.decryptKeyValue.push(entry);
      return "decrypted-secret";
    },
    postKeyEntry: async (body) => {
      calls.postKeyEntry.push(body);
      return {
        entry: {
          ...SAMPLE_ENTRY,
          id: body.id,
          label: body.label,
          serviceId: body.serviceId,
          customServiceName: body.customServiceName ?? null,
          description: body.description ?? null,
          tags: body.tags,
          cipher: body.cipher,
        },
      } satisfies KeyEntryCreateResponse;
    },
    patchKeyEntry: async (id, body) => {
      calls.patchKeyEntry.push({ id, body });
      return {
        entry: {
          ...SAMPLE_ENTRY,
          id,
          label: body.label,
          serviceId: body.serviceId,
          customServiceName: body.customServiceName ?? null,
          description: body.description ?? null,
          tags: body.tags,
          cipher: body.cipher ?? SAMPLE_ENTRY.cipher,
        },
      } satisfies KeyEntryUpdateResponse;
    },
    deleteKeyEntry: async (id, options) => {
      calls.deleteKeyEntry.push({ id, keyVersion: options.keyVersion });
    },
    postKeyEntryUse: async (id, action) => {
      calls.postKeyEntryUse.push({ id, action });
      return {
        entry: {
          ...SAMPLE_ENTRY,
          id,
          lastUsedAt: "2026-01-02T00:00:00.000Z",
        },
      } satisfies KeyEntryUseResponse;
    },
    postKeyEntryImport: async (body) => {
      calls.postKeyEntryImport.push(body);
      return {
        imported: body.entries.length,
        skippedIds: [],
      } satisfies KeyEntryImportResponse;
    },
    copyTextWithAutoClear: async (text, clearMs) => {
      calls.copyTextWithAutoClear.push({ text, clearMs });
      return {
        cancel: () => {},
        clearNow: async () => {},
      } satisfies ClipboardAutoClearHandle;
    },
    ...overrides,
  };

  Object.defineProperty(calls, "guardWrite", {
    get: () => pinCalls.guardWrite,
  });
  Object.defineProperty(calls, "requireForWrite", {
    get: () => pinCalls.requireForWrite,
  });
  Object.defineProperty(calls, "encryptKeyValue", {
    get: () => pinCalls.encryptKeyValue,
  });

  return { ports, calls };
}

describe("keyEntryOperations.create", () => {
  it("normalizes, encrypts under a generated id, and posts", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    const entry = await ops.create({
      label: "  Label  ",
      serviceId: "openai",
      tags: [],
      keyValue: "sk-test",
    });

    assert.equal(entry.id, ENTRY_ID);
    assert.equal(calls.guardWrite, 1);
    assert.equal(calls.encryptKeyValue.length, 1);
    assert.equal(calls.encryptKeyValue[0]!.id, ENTRY_ID);
    assert.equal(calls.postKeyEntry.length, 1);
    assert.equal(calls.postKeyEntry[0]!.label, "Label");
  });
});

describe("keyEntryOperations.update", () => {
  it("includes cipher when keyValue is non-empty", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    await ops.update(ENTRY_ID, {
      label: "Renamed",
      serviceId: "openai",
      tags: [],
      keyValue: "sk-new",
    });

    assert.equal(calls.patchKeyEntry.length, 1);
    assert.ok(calls.patchKeyEntry[0]!.body.cipher);
    assert.equal(calls.patchKeyEntry[0]!.body.keyVersion, 1);
  });

  it("omits cipher when keyValue is empty", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    await ops.update(ENTRY_ID, {
      label: "Renamed",
      serviceId: "openai",
      tags: [],
      keyValue: "",
    });

    assert.equal(calls.patchKeyEntry.length, 1);
    assert.equal(calls.patchKeyEntry[0]!.body.cipher, undefined);
  });

  it("throws when the vault is locked", async () => {
    const { ports } = createFakePorts(
      {},
      {
        requireForWrite: () => {
          throw new ApiError({
            error: "session_expired",
            message: "Vault is locked.",
          });
        },
      },
    );
    const ops = createKeyEntryOperations(ports);

    await assert.rejects(
      () =>
        ops.update(ENTRY_ID, {
          label: "Renamed",
          serviceId: "openai",
          tags: [],
        }),
      (error: unknown) => error instanceof ApiError,
    );
  });
});

describe("keyEntryOperations.remove", () => {
  it("checks keyVersion before delete", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    await ops.remove(ENTRY_ID);

    assert.equal(calls.deleteKeyEntry.length, 1);
    assert.equal(calls.deleteKeyEntry[0]!.keyVersion, 1);
    assert.equal(calls.guardWrite, 1);
    assert.equal(calls.requireForWrite, 1);
  });
});

describe("keyEntryOperations.markUsed", () => {
  it("does not wrap in guardWrite", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    await ops.markUsed(ENTRY_ID, "copied");

    assert.equal(calls.postKeyEntryUse.length, 1);
    assert.equal(calls.guardWrite, 0);
  });
});

describe("keyEntryOperations.revealSecret", () => {
  it("returns decrypted value and records activity", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    const result = await ops.revealSecret(SAMPLE_ENTRY);

    assert.deepEqual(result, {
      ok: true,
      value: "decrypted-secret",
      lastUsedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(calls.decryptKeyValue.length, 1);
    assert.equal(calls.postKeyEntryUse.length, 1);
  });

  it("returns decrypt failure without throwing", async () => {
    const { ports } = createFakePorts({
      decryptKeyValue: async () => {
        throw new Error("decrypt failed");
      },
    });
    const ops = createKeyEntryOperations(ports);

    const result = await ops.revealSecret(SAMPLE_ENTRY);
    assert.deepEqual(result, { ok: false, reason: "decrypt" });
  });

  it("still returns value when activity recording fails", async () => {
    const { ports } = createFakePorts({
      postKeyEntryUse: async () => {
        throw new Error("activity failed");
      },
    });
    const ops = createKeyEntryOperations(ports);

    const result = await ops.revealSecret(SAMPLE_ENTRY);
    assert.deepEqual(result, {
      ok: true,
      value: "decrypted-secret",
      activityFailed: true,
    });
  });
});

describe("keyEntryOperations.copySecret", () => {
  it("reuses revealedValue without decrypting", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    const result = await ops.copySecret(SAMPLE_ENTRY, {
      revealedValue: "already-revealed",
      clipboardClearMs: 30_000,
    });

    assert.deepEqual(result, {
      ok: true,
      clearSeconds: 30,
      lastUsedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(calls.decryptKeyValue.length, 0);
    assert.deepEqual(calls.copyTextWithAutoClear[0], {
      text: "already-revealed",
      clearMs: 30_000,
    });
  });

  it("decrypts when revealedValue is absent", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    await ops.copySecret(SAMPLE_ENTRY, { clipboardClearMs: 15_000 });

    assert.equal(calls.decryptKeyValue.length, 1);
  });

  it("returns clipboard failure with denied reason", async () => {
    const { ports } = createFakePorts({
      copyTextWithAutoClear: async () => {
        throw new ClipboardWriteError("denied");
      },
    });
    const ops = createKeyEntryOperations(ports);

    const result = await ops.copySecret(SAMPLE_ENTRY, {
      clipboardClearMs: 15_000,
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "clipboard",
      clipboard: "denied",
    });
  });

  it("returns clipboard failure with unavailable reason", async () => {
    const { ports } = createFakePorts({
      copyTextWithAutoClear: async () => {
        throw new ClipboardWriteError("unavailable");
      },
    });
    const ops = createKeyEntryOperations(ports);

    const result = await ops.copySecret(SAMPLE_ENTRY, {
      clipboardClearMs: 15_000,
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "clipboard",
      clipboard: "unavailable",
    });
  });

  it("maps unknown clipboard errors to denied", async () => {
    const { ports } = createFakePorts({
      copyTextWithAutoClear: async () => {
        throw new Error("clipboard denied");
      },
    });
    const ops = createKeyEntryOperations(ports);

    const result = await ops.copySecret(SAMPLE_ENTRY, {
      clipboardClearMs: 15_000,
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "clipboard",
      clipboard: "denied",
    });
  });
});

describe("keyEntryOperations.importEntries", () => {
  it("skips existing ids client-side and does not call import when all exist", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    const existing = new Set([ENTRY_A.id, ENTRY_B.id]);
    const result = await ops.importEntries([ENTRY_A, ENTRY_B], existing);

    assert.equal(result.imported, 0);
    assert.equal(result.clientSkipped, 2);
    assert.deepEqual(result.skippedIds, []);
    assert.equal(calls.postKeyEntryImport.length, 0);
    assert.equal(calls.guardWrite, 0);
  });

  it("remaps unknown service ids before import", async () => {
    const { ports, calls } = createFakePorts();
    const ops = createKeyEntryOperations(ports);

    await ops.importEntries(
      [
        {
          ...ENTRY_A,
          serviceId: "legacy-vendor",
          customServiceName: null,
        },
      ],
      new Set(),
    );

    assert.equal(calls.postKeyEntryImport.length, 1);
    assert.equal(calls.postKeyEntryImport[0]!.entries[0]!.serviceId, "custom");
    assert.equal(
      calls.postKeyEntryImport[0]!.entries[0]!.customServiceName,
      "legacy-vendor",
    );
  });

  it("posts only new entries and returns server totals", async () => {
    const { ports, calls } = createFakePorts({
      postKeyEntryImport: async (body) => {
        calls.postKeyEntryImport.push(body);
        return {
          imported: 1,
          skippedIds: [ENTRY_A.id],
        };
      },
    });
    const ops = createKeyEntryOperations(ports);

    const result = await ops.importEntries(
      [ENTRY_A, ENTRY_B],
      new Set([ENTRY_B.id]),
    );

    assert.equal(calls.postKeyEntryImport.length, 1);
    assert.equal(calls.postKeyEntryImport[0]!.entries.length, 1);
    assert.equal(calls.postKeyEntryImport[0]!.entries[0]!.id, ENTRY_A.id);
    assert.equal(result.imported, 1);
    assert.deepEqual(result.skippedIds, [ENTRY_A.id]);
    assert.equal(result.clientSkipped, 1);
    assert.equal(calls.guardWrite, 1);
  });
});
