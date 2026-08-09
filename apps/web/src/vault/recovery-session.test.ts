import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyEntry } from "@keypage/shared";

import { clearEncryptionKey } from "./session-keys.js";
import {
  attachRecoverySessionToKeyClear,
  createRecoverySession,
  recoveryWizardAfterKeyCleared,
} from "./recovery-session.js";

function makeEntry(id: string): KeyEntry {
  return {
    id,
    label: "Test",
    serviceId: "openai",
    customServiceName: null,
    description: null,
    tags: [],
    cipher: {
      algorithm: "aes-256-gcm",
      ivB64: "AAAA",
      ciphertextB64: "BBBB",
      keyVersion: 1,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
  };
}

function masterKey(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4]);
}

function isZeroized(key: Uint8Array): boolean {
  return key.every((byte) => byte === 0);
}

describe("recovery session slice 1 — hold, clear, supersede", () => {
  it("start() holds the ticket, entry snapshot, and recovered master key together (via beginComplete observing them)", () => {
    const session = createRecoverySession();
    const entries = [makeEntry("entry-1")];
    const key = masterKey();

    session.start({ ticket: "ticket-a", entries, masterKey: key });
    assert.equal(session.isActive(), true);

    const attempt = session.beginComplete();
    assert.ok(attempt);
    assert.equal(attempt.ticket, "ticket-a");
    assert.deepEqual(attempt.entries, entries);
    assert.deepEqual(attempt.masterKey, key);
    assert.notEqual(attempt.entries, entries);
    attempt.succeeded();
  });

  it("clear() zeroizes the recovered master key and drops ticket + entries", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    session.clear();

    assert.equal(session.isActive(), false);
    assert.equal(isZeroized(key), true);
    assert.equal(session.beginComplete(), null);
  });

  it("clear() is idempotent", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    session.clear();
    session.clear();

    assert.equal(session.isActive(), false);
    assert.equal(isZeroized(key), true);
    assert.equal(session.beginComplete(), null);
  });

  it("start() supersedes an earlier session and zeroizes the replaced master key", () => {
    const session = createRecoverySession();
    const firstKey = masterKey();
    const secondKey = new Uint8Array([5, 6, 7, 8]);

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: firstKey,
    });
    session.start({
      ticket: "ticket-b",
      entries: [makeEntry("entry-2")],
      masterKey: secondKey,
    });

    assert.equal(isZeroized(firstKey), true);
    assert.equal(session.isActive(), true);

    const attempt = session.beginComplete();
    assert.ok(attempt);
    assert.equal(attempt.ticket, "ticket-b");
    assert.equal(attempt.entries[0]!.id, "entry-2");
    attempt.succeeded();
  });
});

describe("recovery session slice 2 — beginComplete and succeeded", () => {
  it("beginComplete() returns null when no recovery session is active", () => {
    const session = createRecoverySession();
    assert.equal(session.beginComplete(), null);
  });

  it("beginComplete() hands out the ticket, entries, and master key", () => {
    const session = createRecoverySession();
    const entries = [makeEntry("entry-1")];
    const key = masterKey();

    session.start({ ticket: "ticket-a", entries, masterKey: key });
    const attempt = session.beginComplete();

    assert.ok(attempt);
    assert.equal(attempt.ticket, "ticket-a");
    assert.deepEqual(attempt.entries, entries);
    assert.deepEqual(attempt.masterKey, key);
    assert.equal(session.isActive(), false);
    attempt.succeeded();
  });

  it("succeeded() zeroizes the master key and leaves no active session", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);
    assert.equal(attempt.succeeded(), true);

    assert.equal(isZeroized(key), true);
    assert.equal(session.isActive(), false);
    assert.equal(session.beginComplete(), null);
  });

  it("succeeded() is idempotent", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);
    assert.equal(attempt.succeeded(), true);
    assert.equal(attempt.succeeded(), false);

    assert.equal(isZeroized(key), true);
    assert.equal(session.isActive(), false);
  });
});

describe("recovery session slice 3 — failed restores for retry", () => {
  it("failed() restores ticket, entries, and master key so a retry can complete", () => {
    const session = createRecoverySession();
    const entries = [makeEntry("entry-1")];
    const key = masterKey();

    session.start({ ticket: "ticket-a", entries, masterKey: key });
    const attempt = session.beginComplete();
    assert.ok(attempt);
    attempt.failed();

    assert.equal(session.isActive(), true);
    const retry = session.beginComplete();
    assert.ok(retry);
    assert.equal(retry.ticket, "ticket-a");
    assert.deepEqual(retry.entries, entries);
    assert.deepEqual(retry.masterKey, key);
    retry.succeeded();
  });

  it("failed() does not zeroize the restored master key", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);
    attempt.failed();

    assert.equal(isZeroized(key), false);
    const retry = session.beginComplete();
    assert.ok(retry);
    retry.succeeded();
  });
});

describe("recovery session slice 4 — epoch invalidation", () => {
  it("clear() during an in-flight attempt leaves the session inactive", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);
    session.clear();

    assert.equal(session.isActive(), false);
    assert.equal(session.beginComplete(), null);
    attempt.succeeded();
  });

  it("failed() after a clear zeroizes the material instead of restoring it", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);
    session.clear();
    attempt.failed();

    assert.equal(session.isActive(), false);
    assert.equal(isZeroized(key), true);
  });

  it("succeeded() after a clear still zeroizes the master key", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);
    session.clear();
    assert.equal(attempt.succeeded(), false);

    assert.equal(isZeroized(key), true);
    assert.equal(session.isActive(), false);
  });

  it("succeeded() after a clear returns false so callers cannot unlock past the lock", () => {
    const session = createRecoverySession();
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);

    // Simulate idle/manual/cross-tab lock while reset is in flight.
    session.clear();

    assert.equal(attempt.succeeded(), false);
    assert.equal(session.isActive(), false);
    assert.equal(isZeroized(key), true);
  });

  it("failed() after a new start() does not clobber the newer session", () => {
    const session = createRecoverySession();
    const oldKey = masterKey();
    const newKey = new Uint8Array([9, 8, 7, 6]);

    session.start({
      ticket: "ticket-old",
      entries: [makeEntry("entry-old")],
      masterKey: oldKey,
    });
    const attempt = session.beginComplete();
    assert.ok(attempt);

    session.start({
      ticket: "ticket-new",
      entries: [makeEntry("entry-new")],
      masterKey: newKey,
    });
    attempt.failed();

    assert.equal(session.isActive(), true);
    const current = session.beginComplete();
    assert.ok(current);
    assert.equal(current.ticket, "ticket-new");
    assert.equal(current.entries[0]!.id, "entry-new");
    assert.equal(isZeroized(oldKey), true);
    current.succeeded();
  });
});

describe("recovery session slice 5 — key-clear attachment", () => {
  it("clearing the encryption key clears the recovery session (attachRecoverySessionToKeyClear + clearEncryptionKey)", () => {
    const session = createRecoverySession();
    const detach = attachRecoverySessionToKeyClear(session);
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    clearEncryptionKey();

    assert.equal(session.isActive(), false);
    assert.equal(isZeroized(key), true);
    detach();
  });

  it("detaching stops the recovery session from being cleared", () => {
    const session = createRecoverySession();
    const detach = attachRecoverySessionToKeyClear(session);
    const key = masterKey();

    session.start({
      ticket: "ticket-a",
      entries: [makeEntry("entry-1")],
      masterKey: key,
    });
    detach();
    clearEncryptionKey();

    assert.equal(session.isActive(), true);
    const attempt = session.beginComplete();
    assert.ok(attempt);
    attempt.succeeded();
  });
});

describe("recovery session slice 6 — wizard rule", () => {
  it("resets the recovery wizard at the code step", () => {
    const wizard = recoveryWizardAfterKeyCleared({
      kind: "recovery",
      step: 1,
      codes: null,
    });
    assert.deepEqual(wizard, { kind: "none" });
  });

  it("resets the recovery wizard at the new-password step", () => {
    const wizard = recoveryWizardAfterKeyCleared({
      kind: "recovery",
      step: 2,
      codes: null,
    });
    assert.deepEqual(wizard, { kind: "none" });
  });

  it("keeps freshly issued recovery codes on screen (recovery step 3 + kind codes)", () => {
    const recoveryStep3 = recoveryWizardAfterKeyCleared({
      kind: "recovery",
      step: 3,
      codes: ["code-a", "code-b"],
    });
    assert.deepEqual(recoveryStep3, {
      kind: "recovery",
      step: 3,
      codes: ["code-a", "code-b"],
    });

    const codesWizard = recoveryWizardAfterKeyCleared({
      kind: "codes",
      codes: ["code-a", "code-b"],
      reason: "password_change",
    });
    assert.deepEqual(codesWizard, {
      kind: "codes",
      codes: ["code-a", "code-b"],
      reason: "password_change",
    });
  });

  it("leaves setup and idle wizard states alone", () => {
    assert.deepEqual(recoveryWizardAfterKeyCleared({ kind: "none" }), {
      kind: "none",
    });
    assert.deepEqual(
      recoveryWizardAfterKeyCleared({ kind: "setup", step: 1, codes: null }),
      { kind: "setup", step: 1, codes: null },
    );
    assert.deepEqual(
      recoveryWizardAfterKeyCleared({
        kind: "setup",
        step: 3,
        codes: ["setup-code"],
      }),
      { kind: "setup", step: 3, codes: ["setup-code"] },
    );
  });
});
