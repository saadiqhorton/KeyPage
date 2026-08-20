import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  base64Decode,
  keyEntryWriteAuthMessage,
  loginStoredKeyHexFromAuthKey,
  verifyClientProof,
} from "@keypage/shared";

import { postKeyEntry } from "./api.js";
import { clearEncryptionKey, setEncryptionKey } from "@/vault/session-keys.js";

describe("Key Entry write API proofs", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearEncryptionKey();
  });

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
      return new Response(JSON.stringify({ entry: { ...body, createdAt: "now", updatedAt: "now", lastUsedAt: null } }), { status: 201 });
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
