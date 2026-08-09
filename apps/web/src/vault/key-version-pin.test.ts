import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { KeyEntryCipherPayload } from "@keypage/shared";

import type { AesKey } from "@/crypto/provider.js";
import { ApiError } from "@/lib/api.js";

import { createKeyVersionPin } from "./key-version-pin.js";

const SESSION_EXPIRED = () =>
  new ApiError({ error: "session_expired", message: "Vault is locked." });

const SAMPLE_PAYLOAD: KeyEntryCipherPayload = {
  algorithm: "aes-256-gcm",
  ivB64: "AAAAAAAAAAAAAAAA",
  ciphertextB64: "BBBBBBBBBBBBBBBBBBBBBBBB",
};

function fakeKey(): AesKey {
  return { kind: "fallback", bytes: new Uint8Array(32) };
}

function createDeps(
  overrides: Partial<Parameters<typeof createKeyVersionPin>[0]> = {},
) {
  const calls = {
    encryptPayload: [] as Array<{ key: AesKey; id: string; keyValue: string }>,
    lockLocal: 0 as number,
    lockLocalReasons: [] as Array<"rekeyed">,
  };

  const deps = {
    getVersion: () => 1,
    getKey: () => fakeKey(),
    encryptPayload: async (key: AesKey, id: string, keyValue: string) => {
      calls.encryptPayload.push({ key, id, keyValue });
      return SAMPLE_PAYLOAD;
    },
    lockLocal: async (reason: "rekeyed") => {
      calls.lockLocal += 1;
      calls.lockLocalReasons.push(reason);
    },
    createSessionExpiredError: SESSION_EXPIRED,
    ...overrides,
  };

  return { pin: createKeyVersionPin(deps), calls, deps };
}

describe("key-version-pin.requireForWrite", () => {
  it("throws session_expired when version is null", () => {
    const { pin } = createDeps({ getVersion: () => null });

    assert.throws(() => pin.requireForWrite(), (error: unknown) => {
      return error instanceof ApiError && error.code === "session_expired";
    });
  });

  it("returns the current version when set", () => {
    const { pin } = createDeps({ getVersion: () => 3 });
    assert.equal(pin.requireForWrite(), 3);
  });
});

describe("key-version-pin.encryptKeyValue", () => {
  it("stamps cipher.keyVersion and calls encryptPayload with the session key", async () => {
    const key = fakeKey();
    const { pin, calls } = createDeps({
      getKey: () => key,
      getVersion: () => 2,
    });

    const cipher = await pin.encryptKeyValue("entry-id", "sk-secret");

    assert.deepEqual(cipher, { ...SAMPLE_PAYLOAD, keyVersion: 2 });
    assert.equal(calls.encryptPayload.length, 1);
    assert.equal(calls.encryptPayload[0]!.key, key);
    assert.equal(calls.encryptPayload[0]!.id, "entry-id");
    assert.equal(calls.encryptPayload[0]!.keyValue, "sk-secret");
  });

  it("throws session_expired without encrypting when version is null", async () => {
    const { pin, calls } = createDeps({
      getVersion: () => null,
      getKey: () => fakeKey(),
    });

    await assert.rejects(
      () => pin.encryptKeyValue("entry-id", "sk-secret"),
      (error: unknown) =>
        error instanceof ApiError && error.code === "session_expired",
    );
    assert.equal(calls.encryptPayload.length, 0);
  });

  it("throws session_expired without encrypting when key is null", async () => {
    const { pin, calls } = createDeps({
      getVersion: () => 1,
      getKey: () => null,
    });

    await assert.rejects(
      () => pin.encryptKeyValue("entry-id", "sk-secret"),
      (error: unknown) =>
        error instanceof ApiError && error.code === "session_expired",
    );
    assert.equal(calls.encryptPayload.length, 0);
  });
});

describe("key-version-pin.guardWrite", () => {
  it("returns the result without calling lockLocal on success", async () => {
    const { pin, calls } = createDeps();

    const result = await pin.guardWrite(Promise.resolve("ok"));

    assert.equal(result, "ok");
    assert.equal(calls.lockLocal, 0);
  });

  it("calls lockLocal(rekeyed) once and rethrows on key_version_mismatch", async () => {
    const { pin, calls } = createDeps();
    const mismatch = new ApiError({
      error: "key_version_mismatch",
      message: "Key version mismatch.",
    });

    await assert.rejects(
      () => pin.guardWrite(Promise.reject(mismatch)),
      (error: unknown) => error === mismatch,
    );
    assert.equal(calls.lockLocal, 1);
    assert.deepEqual(calls.lockLocalReasons, ["rekeyed"]);
  });

  it("does not call lockLocal for other ApiError codes", async () => {
    const { pin, calls } = createDeps();
    const other = new ApiError({
      error: "session_expired",
      message: "Vault is locked.",
    });

    await assert.rejects(
      () => pin.guardWrite(Promise.reject(other)),
      (error: unknown) => error === other,
    );
    assert.equal(calls.lockLocal, 0);
  });

  it("does not call lockLocal for non-ApiError failures", async () => {
    const { pin, calls } = createDeps();
    const error = new Error("network");

    await assert.rejects(
      () => pin.guardWrite(Promise.reject(error)),
      (err: unknown) => err === error,
    );
    assert.equal(calls.lockLocal, 0);
  });
});
