import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { downloadRecoveryCodes } from "./recovery-download.js";
import { useVault, VaultContext, type VaultActions } from "./useVault.js";
import {
  broadcastLock,
  clearEncryptionKey,
  getEncryptionKey,
  getEncryptionKeyVersion,
  onKeyCleared,
  replaceEncryptionKey,
  setEncryptionKey,
  subscribeLockBroadcast,
} from "./session-keys.js";
import { createKeyVersionPin } from "./key-version-pin.js";
import { ApiError } from "@/lib/api.js";

describe("recovery-download", () => {
  const original = {
    document: globalThis.document,
    URL: globalThis.URL,
    Blob: globalThis.Blob,
    setTimeout: globalThis.setTimeout,
  };

  afterEach(() => {
    globalThis.document = original.document;
    globalThis.URL = original.URL;
    globalThis.Blob = original.Blob;
    globalThis.setTimeout = original.setTimeout;
  });

  it("downloads a recovery codes text file", () => {
    const clicks: string[] = [];
    globalThis.Blob = class {
      constructor(public parts: unknown[], public options?: { type?: string }) {}
    } as unknown as typeof Blob;
    globalThis.URL = {
      createObjectURL: () => "blob:codes",
      revokeObjectURL() {},
    } as unknown as typeof URL;
    globalThis.document = {
      createElement: () => ({
        href: "",
        download: "",
        style: {},
        click() {
          clicks.push(this.download);
        },
        remove() {},
      }),
      body: { appendChild() {} },
    } as unknown as Document;
    globalThis.setTimeout = ((handler: () => void) => {
      handler();
      return 1;
    }) as typeof setTimeout;

    downloadRecoveryCodes(["AAAAA11111BBBBB22222"]);
    assert.equal(clicks.length, 1);
    assert.match(clicks[0]!, /keypage-recovery-codes-/);
  });
});

describe("useVault", () => {
  it("throws outside a provider", () => {
    function Probe() {
      useVault();
      return null;
    }
    assert.throws(
      () => renderToStaticMarkup(<Probe />),
      /useVault must be used within VaultProvider/,
    );
  });

  it("returns the provided context value", () => {
    const actions = { refreshStatus: async () => undefined } as VaultActions;
    function Probe() {
      const value = useVault();
      return <span>{value.state.phase}</span>;
    }
    const html = renderToStaticMarkup(
      <VaultContext.Provider
        value={{
          state: { phase: "loading" },
          wizard: { kind: "none" },
          actions,
          issuingRecoveryCodes: false,
        }}
      >
        <Probe />
      </VaultContext.Provider>,
    );
    assert.match(html, /loading/);
  });
});

describe("session-keys extras", () => {
  afterEach(() => clearEncryptionKey());

  it("tracks version and replaceEncryptionKey", () => {
    setEncryptionKey({ kind: "fallback", bytes: new Uint8Array(32).fill(1) }, 4);
    assert.equal(getEncryptionKeyVersion(), 4);
    replaceEncryptionKey({ kind: "fallback", bytes: new Uint8Array(32).fill(2) }, 5);
    assert.equal(getEncryptionKeyVersion(), 5);
    assert.deepEqual(
      (getEncryptionKey() as { kind: "fallback"; bytes: Uint8Array }).bytes,
      new Uint8Array(32).fill(2),
    );
  });

  it("notifies key-cleared listeners and unsubscribes", () => {
    let calls = 0;
    const stop = onKeyCleared(() => {
      calls += 1;
    });
    clearEncryptionKey();
    assert.equal(calls, 1);
    stop();
    clearEncryptionKey();
    assert.equal(calls, 1);
  });

  it("broadcastLock and subscribeLockBroadcast fail closed without BroadcastChannel", () => {
    broadcastLock("manual");
    const stop = subscribeLockBroadcast(() => undefined);
    stop();
  });
});

describe("key-version pin", () => {
  it("requires a version, encrypts with a stamp, and locks on mismatch", async () => {
    let locked: string | null = null;
    const pin = createKeyVersionPin({
      getVersion: () => 3,
      getKey: () => ({ kind: "fallback", bytes: new Uint8Array(32).fill(1) }),
      encryptPayload: async () => ({
        algorithm: "aes-256-gcm",
        ivB64: "iv",
        ciphertextB64: "ct",
      }),
      lockLocal: async (reason) => {
        locked = reason;
      },
      createSessionExpiredError: () =>
        new ApiError({ error: "session_expired", message: "Vault is locked." }),
    });
    assert.equal(pin.current(), 3);
    assert.equal(pin.requireForWrite(), 3);
    const cipher = await pin.encryptKeyValue("id", "secret");
    assert.equal(cipher.keyVersion, 3);
    await assert.rejects(
      () =>
        pin.guardWrite(
          Promise.reject(
            new ApiError({
              error: "key_version_mismatch",
              message: "rotated",
            }),
          ),
        ),
      ApiError,
    );
    assert.equal(locked, "rekeyed");
  });

  it("fails closed when the pin or key is missing", async () => {
    const pin = createKeyVersionPin({
      getVersion: () => null,
      getKey: () => null,
      encryptPayload: async () => {
        throw new Error("unused");
      },
      lockLocal: async () => undefined,
      createSessionExpiredError: () =>
        new ApiError({ error: "session_expired", message: "Vault is locked." }),
    });
    assert.throws(() => pin.requireForWrite(), ApiError);
    const withVersion = createKeyVersionPin({
      getVersion: () => 1,
      getKey: () => null,
      encryptPayload: async () => {
        throw new Error("unused");
      },
      lockLocal: async () => undefined,
      createSessionExpiredError: () =>
        new ApiError({ error: "session_expired", message: "Vault is locked." }),
    });
    await assert.rejects(() => withVersion.encryptKeyValue("id", "x"), ApiError);
  });
});
