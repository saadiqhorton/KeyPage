import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  ClipboardWriteError,
  createClipboardCopier,
  type ClipboardEnv,
} from "./clipboard.ts";

type TimerEntry = { ms: number; handler: () => void };

function createTimerEnv(
  clipboard: ClipboardEnv["clipboard"],
  isSecureContext = true,
) {
  const timers = new Map<number, TimerEntry>();
  let nextId = 1;

  const env: ClipboardEnv = {
    clipboard,
    isSecureContext,
    setTimeout(handler, ms) {
      const id = nextId++;
      timers.set(id, { ms, handler });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  function flushDue(upToMs: number) {
    for (const [id, entry] of [...timers.entries()]) {
      if (entry.ms <= upToMs) {
        timers.delete(id);
        entry.handler();
      }
    }
  }

  return { env, timers, flushDue };
}

async function runDueTimers(flushDue: (ms: number) => void, ms: number) {
  flushDue(ms);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function installCreateElementSpy() {
  let called = false;
  const prior = globalThis.document;
  globalThis.document = {
    createElement: () => {
      called = true;
      throw new Error("createElement must not be called");
    },
  } as unknown as Document;

  return {
    wasCalled: () => called,
    restore: () => {
      if (prior === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        globalThis.document = prior;
      }
    },
  };
}

describe("createClipboardCopier", () => {
  let spy: ReturnType<typeof installCreateElementSpy>;

  beforeEach(() => {
    spy = installCreateElementSpy();
  });

  afterEach(() => {
    spy.restore();
  });

  it("rejects unavailable when clipboard is missing", async () => {
    const { env, timers } = createTimerEnv(undefined);
    const copier = createClipboardCopier(env);

    await assert.rejects(
      () => copier.copyTextWithAutoClear("secret", 1000),
      (err: unknown) => {
        assert.ok(err instanceof ClipboardWriteError);
        assert.equal(err.reason, "unavailable");
        return true;
      },
    );
    assert.equal(timers.size, 0);
    assert.equal(spy.wasCalled(), false);
  });

  it("rejects unavailable when writeText fails on an insecure context", async () => {
    const mockClipboard = {
      writeText: async () => {
        throw new Error("insecure context");
      },
      readText: async () => "",
    };
    const { env, timers } = createTimerEnv(mockClipboard, false);
    const copier = createClipboardCopier(env);

    await assert.rejects(
      () => copier.copyTextWithAutoClear("secret", 1000),
      (err: unknown) => {
        assert.ok(err instanceof ClipboardWriteError);
        assert.equal(err.reason, "unavailable");
        return true;
      },
    );
    assert.equal(timers.size, 0);
    assert.equal(spy.wasCalled(), false);
  });

  it("rejects denied when writeText fails on a secure context", async () => {
    const mockClipboard = {
      writeText: async () => {
        throw new Error("denied");
      },
      readText: async () => "",
    };
    const { env, timers } = createTimerEnv(mockClipboard, true);
    const copier = createClipboardCopier(env);

    await assert.rejects(
      () => copier.copyTextWithAutoClear("secret", 1000),
      (err: unknown) => {
        assert.ok(err instanceof ClipboardWriteError);
        assert.equal(err.reason, "denied");
        return true;
      },
    );
    assert.equal(timers.size, 0);
    assert.equal(spy.wasCalled(), false);
  });

  it("writes text and clears after clearAfterMs when readText matches", async () => {
    const writes: string[] = [];
    const mockClipboard = {
      writeText: async (text: string) => {
        writes.push(text);
      },
      readText: async () => "secret",
    };
    const { env, flushDue } = createTimerEnv(mockClipboard);
    const copier = createClipboardCopier(env);

    await copier.copyTextWithAutoClear("secret", 1000);
    assert.deepEqual(writes, ["secret"]);

    await runDueTimers(flushDue, 1000);
    assert.deepEqual(writes, ["secret", ""]);
    assert.equal(spy.wasCalled(), false);
  });

  it("cancel() prevents scheduled clear", async () => {
    const writes: string[] = [];
    const mockClipboard = {
      writeText: async (text: string) => {
        writes.push(text);
      },
      readText: async () => "secret",
    };
    const { env, flushDue } = createTimerEnv(mockClipboard);
    const copier = createClipboardCopier(env);

    const handle = await copier.copyTextWithAutoClear("secret", 1000);
    handle.cancel();

    await runDueTimers(flushDue, 1000);
    assert.deepEqual(writes, ["secret"]);
  });

  it("clearNow() clears immediately", async () => {
    const writes: string[] = [];
    const mockClipboard = {
      writeText: async (text: string) => {
        writes.push(text);
      },
      readText: async () => "secret",
    };
    const { env } = createTimerEnv(mockClipboard);
    const copier = createClipboardCopier(env);

    const handle = await copier.copyTextWithAutoClear("secret", 5000);
    await handle.clearNow();
    assert.deepEqual(writes, ["secret", ""]);
  });

  it("still attempts blank write when readText is denied", async () => {
    const writes: string[] = [];
    const mockClipboard = {
      writeText: async (text: string) => {
        writes.push(text);
      },
      readText: async () => {
        throw new Error("read denied");
      },
    };
    const { env, flushDue } = createTimerEnv(mockClipboard);
    const copier = createClipboardCopier(env);

    await copier.copyTextWithAutoClear("secret", 1000);
    await runDueTimers(flushDue, 1000);
    assert.deepEqual(writes, ["secret", ""]);
  });

  it("resolves without throw when blank write fails after success", async () => {
    let writeCount = 0;
    const mockClipboard = {
      writeText: async (text: string) => {
        writeCount += 1;
        if (writeCount > 1) {
          throw new Error("blank write denied");
        }
        assert.equal(text, "secret");
      },
      readText: async () => "secret",
    };
    const { env, flushDue } = createTimerEnv(mockClipboard);
    const copier = createClipboardCopier(env);

    await copier.copyTextWithAutoClear("secret", 1000);
    await runDueTimers(flushDue, 1000);
    assert.equal(writeCount, 2);
    assert.equal(spy.wasCalled(), false);
  });
});
