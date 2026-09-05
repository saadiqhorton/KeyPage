import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  base64Decode,
  keyEntryWriteAuthMessage,
  loginStoredKeyHexFromAuthKey,
  verifyClientProof,
} from "@keypage/shared";

import {
  ApiError,
  deleteKeyEntry,
  getAppSettings,
  getKeyEntries,
  getVaultSession,
  getVaultStatus,
  patchAppSettings,
  patchKeyEntry,
  postKeyEntry,
  postKeyEntryImport,
  postKeyEntryUse,
  postRecoveryCancel,
  postRecoveryClaim,
  postRecoveryCodesRegenerate,
  postRecoveryReset,
  postVaultLock,
  postVaultLogin,
  postVaultLoginChallenge,
  postVaultLoginWithAuthKey,
  postVaultPasswordChange,
  postVaultSessionTouch,
  postVaultSetup,
} from "./api.js";
import { clearEncryptionKey, setEncryptionKey } from "@/vault/session-keys.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearEncryptionKey();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = async (input, init) => handler(String(input), init);
}

describe("Key Entry write API proofs", () => {
  it("answers a challenge with a proof bound to the exact create body", async () => {
    const authKey = new Uint8Array(32).fill(7);
    setEncryptionKey(
      { kind: "fallback", bytes: new Uint8Array(32).fill(3) },
      1,
      Buffer.from(authKey).toString("base64"),
    );
    const body = {
      id: "11111111-1111-4111-8111-111111111111",
      label: "Test",
      serviceId: "openai",
      tags: [],
      cipher: {
        algorithm: "aes-256-gcm" as const,
        ivB64: Buffer.alloc(12, 1).toString("base64"),
        ciphertextB64: Buffer.alloc(17, 2).toString("base64"),
        keyVersion: 1,
      },
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/keys/challenge") {
        return new Response(
          JSON.stringify({ challengeId: "chal-1", nonceB64: "bm9uY2U=" }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          entry: { ...body, createdAt: "now", updatedAt: "now", lastUsedAt: null },
        }),
        { status: 201 },
      );
    };

    await postKeyEntry(body);

    assert.equal(calls.length, 2);
    assert.equal(calls[1]!.init?.body, JSON.stringify(body));
    const headers = new Headers(calls[1]!.init?.headers);
    const message = keyEntryWriteAuthMessage({
      challengeId: "chal-1",
      nonceB64: "bm9uY2U=",
      method: "POST",
      path: "/api/keys",
      bodyJson: JSON.stringify(body),
    });
    assert.equal(
      verifyClientProof(
        loginStoredKeyHexFromAuthKey(authKey),
        message,
        base64Decode(headers.get("x-keypage-write-proof")!),
      ),
      true,
    );
  });
});

describe("ApiError", () => {
  it("exposes the API error code and body", () => {
    const error = new ApiError({
      error: "session_expired",
      message: "Vault is locked.",
    });
    assert.equal(error.name, "ApiError");
    assert.equal(error.code, "session_expired");
    assert.equal(error.message, "Vault is locked.");
    assert.equal(error.body.error, "session_expired");
  });
});

describe("apiFetch error and empty-body paths", () => {
  it("wraps a network failure", async () => {
    installFetch(() => {
      throw new Error("offline");
    });
    await assert.rejects(
      () => getVaultStatus(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "internal_error");
        assert.equal(error.message, "Unable to reach the KeyPage server.");
        return true;
      },
    );
  });

  it("returns undefined for 204 responses", async () => {
    installFetch(() => new Response(null, { status: 204 }));
    const result = await postVaultLock();
    assert.equal(result, undefined);
  });

  it("rejects invalid JSON on a successful response", async () => {
    installFetch(() => new Response("not-json", { status: 200 }));
    await assert.rejects(
      () => getVaultStatus(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.message, "The server returned an invalid response.");
        return true;
      },
    );
  });

  it("rethrows structured API errors", async () => {
    installFetch(() =>
      jsonResponse(
        { error: "unauthenticated", message: "Not signed in." },
        401,
      ),
    );
    await assert.rejects(
      () => getVaultSession(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "unauthenticated");
        assert.equal(error.message, "Not signed in.");
        return true;
      },
    );
  });

  it("synthesizes an internal error when the error body is missing fields", async () => {
    installFetch(() => jsonResponse({ oops: true }, 500));
    await assert.rejects(
      () => getVaultStatus(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "internal_error");
        assert.match(error.message, /status 500/);
        return true;
      },
    );
  });
});

describe("vault and settings API wrappers", () => {
  it("GETs vault status and key entries", async () => {
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url === "/api/vault/status") {
        return jsonResponse({ state: "locked" });
      }
      return jsonResponse({ entries: [], clipboardClearSeconds: 30 });
    });
    assert.deepEqual(await getVaultStatus(), { state: "locked" });
    assert.deepEqual(await getKeyEntries(), {
      entries: [],
      clipboardClearSeconds: 30,
    });
    assert.deepEqual(calls, ["/api/vault/status", "/api/keys"]);
  });

  it("POSTs setup, login challenge, login, and session touch", async () => {
    const methods: Array<{ url: string; method: string }> = [];
    installFetch((url, init) => {
      methods.push({ url, method: String(init?.method ?? "GET") });
      if (url.endsWith("/setup")) {
        return jsonResponse({ keyVersion: 1, session: { idleTimeoutSeconds: 1200 } });
      }
      if (url.endsWith("/login/challenge")) {
        return jsonResponse({ challengeId: "c1", nonceB64: "bm9uY2U=" });
      }
      if (url.endsWith("/login")) {
        return jsonResponse({ keyVersion: 1, session: { idleTimeoutSeconds: 900 } });
      }
      if (url.endsWith("/session")) {
        return jsonResponse({ authenticated: true, idleTimeoutSeconds: 900 });
      }
      return new Response(null, { status: 204 });
    });

    await postVaultSetup({
      setupToken: "token",
      kdf: { algorithm: "pbkdf2-sha256", saltB64: "YQ==", iterations: 1 },
      authStoredKeyHex: "aa",
      recoveryStoredKeyHex: "bb",
      recoveryCodes: [],
    });
    await postVaultLoginChallenge();
    await postVaultLogin({
      challengeId: "c1",
      nonceB64: "bm9uY2U=",
      clientProofB64: "cHJvb2Y=",
    });
    await getVaultSession();
    await postVaultSessionTouch();

    assert.deepEqual(
      methods.map((call) => `${call.method} ${call.url}`),
      [
        "POST /api/vault/setup",
        "POST /api/vault/login/challenge",
        "POST /api/vault/login",
        "GET /api/vault/session",
        "POST /api/vault/session/touch",
      ],
    );
  });

  it("proves login with the session auth key", async () => {
    const authKey = new Uint8Array(32).fill(9);
    installFetch((url) => {
      if (url === "/api/vault/login/challenge") {
        return jsonResponse({ challengeId: "chal-login", nonceB64: "bm9uY2U=" });
      }
      return jsonResponse({
        keyVersion: 2,
        session: { idleTimeoutSeconds: 1200, authenticated: true },
      });
    });
    const response = await postVaultLoginWithAuthKey(
      Buffer.from(authKey).toString("base64"),
    );
    assert.equal(response.keyVersion, 2);
  });

  it("covers recovery, password, settings, and key-use wrappers", async () => {
    installFetch((url, init) => {
      if (url === "/api/vault/recovery/claim") {
        return jsonResponse({ recoveryTicket: "t" });
      }
      if (url === "/api/vault/recovery/cancel") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/vault/recovery/reset") {
        return jsonResponse({ reEncrypted: 0, keyVersion: 2, session: {} });
      }
      if (url === "/api/vault/password") {
        return jsonResponse({ reEncrypted: 1, keyVersion: 2 });
      }
      if (url === "/api/vault/recovery-codes") {
        return jsonResponse({ ok: true });
      }
      if (url === "/api/settings" && init?.method === "PATCH") {
        return jsonResponse({ sessionIdleMinutes: 25, sessionIdleSource: "db" });
      }
      if (url === "/api/settings") {
        return jsonResponse({ sessionIdleMinutes: 20, sessionIdleSource: "default" });
      }
      if (url.endsWith("/use")) {
        return jsonResponse({ entry: { id: "k1" } });
      }
      return jsonResponse({});
    });

    assert.equal(
      (await postRecoveryClaim({ lookupHash: "abc" })).recoveryTicket,
      "t",
    );
    await postRecoveryCancel({ recoveryTicket: "t" });
    assert.equal(
      (
        await postRecoveryReset({
          recoveryTicket: "t",
          challengeNonceB64: "bg==",
          recoveryClientProofB64: "cA==",
          kdf: { algorithm: "pbkdf2-sha256", saltB64: "YQ==", iterations: 1 },
          authStoredKeyHex: "aa",
          recoveryStoredKeyHex: "bb",
          recoveryCodes: [],
          entries: [],
        })
      ).reEncrypted,
      0,
    );
    assert.equal(
      (
        await postVaultPasswordChange({
          challengeId: "c",
          nonceB64: "bg==",
          currentClientProofB64: "cA==",
          kdf: { algorithm: "pbkdf2-sha256", saltB64: "YQ==", iterations: 1 },
          authStoredKeyHex: "aa",
          recoveryStoredKeyHex: "bb",
          recoveryCodes: [],
          entries: [],
        })
      ).reEncrypted,
      1,
    );
    await postRecoveryCodesRegenerate({
      challengeId: "c",
      nonceB64: "bg==",
      clientProofB64: "cA==",
      keyVersion: 1,
      recoveryCodes: [],
    });
    assert.equal((await getAppSettings()).sessionIdleMinutes, 20);
    assert.equal(
      (await patchAppSettings({ sessionIdleMinutes: 25 })).sessionIdleMinutes,
      25,
    );
    assert.equal((await postKeyEntryUse("k1", "copied")).entry.id, "k1");
  });
});

describe("key entry write helpers", () => {
  it("fails closed when the vault has no auth proof key", async () => {
    clearEncryptionKey();
    await assert.rejects(
      () =>
        patchKeyEntry("11111111-1111-4111-8111-111111111111", {
          keyVersion: 1,
          label: "x",
          serviceId: "openai",
          tags: [],
        }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "session_expired");
        assert.equal(error.message, "Vault is locked.");
        return true;
      },
    );
  });

  it("sends PATCH, DELETE, and import proofs", async () => {
    const authKey = new Uint8Array(32).fill(7);
    setEncryptionKey(
      { kind: "fallback", bytes: new Uint8Array(32).fill(3) },
      1,
      Buffer.from(authKey).toString("base64"),
    );
    const methods: string[] = [];
    installFetch((url, init) => {
      methods.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/keys/challenge") {
        return jsonResponse({ challengeId: "chal-1", nonceB64: "bm9uY2U=" });
      }
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (url === "/api/keys/import") {
        return jsonResponse({ imported: 1, skippedIds: [] }, 201);
      }
      return jsonResponse({ entry: { id: "updated" } });
    });

    const id = "11111111-1111-4111-8111-111111111111";
    await patchKeyEntry(id, {
      keyVersion: 1,
      label: "Updated",
      serviceId: "openai",
      tags: [],
    });
    await deleteKeyEntry(id, { keyVersion: 1 });
    const imported = await postKeyEntryImport({ entries: [] });
    assert.equal(imported.imported, 1);
    assert.ok(methods.includes(`PATCH /api/keys/${id}`));
    assert.ok(methods.includes(`DELETE /api/keys/${id}`));
    assert.ok(methods.includes("POST /api/keys/import"));
  });
});
