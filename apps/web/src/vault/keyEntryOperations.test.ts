import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BackupEntry } from "@keypage/shared";

import { createKeyEntryOperations } from "./keyEntryOperations.js";

const ENTRY_A: BackupEntry = {
  id: "550e8400-e29b-41d4-a716-446655440000",
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
  id: "550e8400-e29b-41d4-a716-446655440001",
  label: "B",
  keyValue: "sk-b",
};

describe("keyEntryOperations.importEntries", () => {
  it("skips existing ids client-side and does not call import when all exist", async () => {
    let importCalls = 0;
    const ops = createKeyEntryOperations(async (promise) => {
      importCalls += 1;
      return promise;
    });

    // Monkey-patch would be heavy; exercise the skip path by stubbing via
    // a local override of the module is awkward in node:test. Instead, verify
    // the pure skip accounting with a fake by temporarily wrapping.
    const existing = new Set([ENTRY_A.id, ENTRY_B.id]);
    const result = await ops.importEntries([ENTRY_A, ENTRY_B], existing);

    assert.equal(result.imported, 0);
    assert.equal(result.clientSkipped, 2);
    assert.deepEqual(result.skippedIds, []);
    assert.equal(importCalls, 0);
  });
});
